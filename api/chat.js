// api/chat.js
// هذه الدالة تعمل على خادم Vercel (سيرفرلس) — مفتاح Groq يبقى هنا فقط ولا يصل أبداً لمتصفح المستخدم.
// تدعم وضعين: chat (محادثة عادية + اكتشاف تلقائي لطلبات الصور) و image (طلب صورة مباشر من الزر).

const SYSTEM_PROMPT = `You are "Jasmine" (جاسمين), a warm, helpful, multilingual AI assistant created for the public to use for free.
Always reply in the same language the user writes in (Arabic or English), matching their dialect/register naturally.
If the user writes in Arabic, reply in Arabic. If in English, reply in English. If mixed, mirror the dominant language.
Be concise, friendly, and genuinely useful. Use simple formatting (short paragraphs, lists when helpful).

Special case — images: if (and only if) the user is asking you to draw, create, generate, design, or imagine an image/picture/logo/artwork/illustration, do NOT write a normal reply. Instead reply with EXACTLY one line and nothing else, in this exact format:
IMAGE_REQUEST::<a short, vivid, detailed prompt in English describing the image, translated and enhanced from the user's request>
Do not add any greeting, explanation, or extra text before or after that line. For every other kind of message, ignore this rule and reply normally as instructed above.`;

const TRANSLATE_PROMPT = `You turn a user's image request (in Arabic or English) into a short, vivid, detailed image-generation prompt in English. Reply with ONLY the prompt text, nothing else — no quotes, no explanation, no prefix.`;

const MODEL = "llama-3.3-70b-versatile"; // نموذج مجاني عبر Groq، سريع وجيد بالعربي والإنجليزي

async function callGroq(apiKey, systemPrompt, messages, maxTokens) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });
  return res;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "GROQ_API_KEY غير مضبوط في إعدادات Vercel. راجع ملف README.",
    });
    return;
  }

  try {
    const { messages, mode } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages مطلوبة" });
      return;
    }

    const trimmed = messages.slice(-20);

    // ===== وضع "إنشاء صورة" المباشر (زر الصورة) =====
    if (mode === "image") {
      const lastUserMsg = [...trimmed].reverse().find((m) => m.role === "user");
      const rawPrompt = lastUserMsg?.content?.trim();
      if (!rawPrompt) {
        res.status(400).json({ error: "الرجاء وصف الصورة" });
        return;
      }

      const groqRes = await callGroq(apiKey, TRANSLATE_PROMPT, [{ role: "user", content: rawPrompt }], 150);

      if (!groqRes.ok) {
        if (groqRes.status === 429) {
          res.status(429).json({ error: "الخدمة مزدحمة حالياً، حاول بعد دقيقة." });
          return;
        }
        const errText = await groqRes.text();
        res.status(groqRes.status).json({ error: "خطأ من مزوّد النموذج", details: errText });
        return;
      }

      const data = await groqRes.json();
      const enhancedPrompt = (data.choices?.[0]?.message?.content || rawPrompt).trim();
      res.status(200).json({ type: "image", prompt: enhancedPrompt });
      return;
    }

    // ===== وضع المحادثة العادي (+ اكتشاف تلقائي لطلبات الصور) =====
    const groqRes = await callGroq(apiKey, SYSTEM_PROMPT, trimmed, 1024);

    if (!groqRes.ok) {
      if (groqRes.status === 429) {
        res.status(429).json({
          error: "الخدمة مزدحمة حالياً (تجاوزنا الحد المجاني المؤقت). حاول بعد دقيقة.",
        });
        return;
      }
      const errText = await groqRes.text();
      res.status(groqRes.status).json({ error: "خطأ من مزوّد النموذج", details: errText });
      return;
    }

    const data = await groqRes.json();
    const reply = (data.choices?.[0]?.message?.content ?? "").trim();

    if (reply.startsWith("IMAGE_REQUEST::")) {
      const prompt = reply.slice("IMAGE_REQUEST::".length).trim();
      res.status(200).json({ type: "image", prompt: prompt || "a beautiful jasmine flower" });
      return;
    }

    res.status(200).json({ type: "text", reply });
  } catch (err) {
    res.status(500).json({ error: "خطأ داخلي في الخادم", details: String(err) });
  }
};

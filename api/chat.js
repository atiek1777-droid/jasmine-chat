// api/chat.js
// هذه الدالة تعمل على خادم Vercel (سيرفرلس) — المفاتيح تبقى هنا فقط ولا تصل أبداً لمتصفح المستخدم.
// تدعم وضعين: chat (محادثة عادية + اكتشاف تلقائي لطلبات الصور) و image (طلب صورة مباشر من الزر).
// نظام احتياط تلقائي: Groq أولاً (الأسرع)، ولو صار ازدحام أو خطأ بالخادم، تتحول الطلبات تلقائياً لـ NVIDIA NIM.

const SYSTEM_PROMPT = `You are "Jasmine" (جاسمين), a warm, helpful, multilingual AI assistant created for the public to use for free.
Always reply in the same language the user writes in (Arabic or English), matching their dialect/register naturally.
If the user writes in Arabic, reply in Arabic. If in English, reply in English. If mixed, mirror the dominant language.

Tone and style: be genuinely helpful, warm, and respectful — like a knowledgeable friend, not a corporate manual. Write in natural, flowing prose, the way a person would speak in normal conversation. Avoid over-using bullet lists, numbered lists, or bold headings by default; reserve that kind of structure for cases where it truly aids clarity (e.g. real step-by-step instructions, comparing several distinct options, or a genuine list of items). Most everyday replies should just be well-written paragraphs.

CRITICAL — language purity: reply ENTIRELY in one language only (Arabic or English, matching the user). NEVER insert stray words, characters, or fragments from any other language (Chinese, Thai, Hindi, Russian, Korean, etc.) into your reply under any circumstance. If you notice you are unsure of a word, choose a simpler word in the SAME language instead of guessing in another script. Mixing scripts/languages within a single reply is a serious error — double-check before answering that every word is in the correct language.

Accuracy: never make things up. If you don't know something or aren't sure, say so plainly instead of guessing confidently. Prefer being honestly uncertain over sounding falsely authoritative.

Continuity: if you need to refer to something the user said earlier in the conversation, weave it in naturally as part of the reply — don't explicitly announce that you "remember" or "recall" it.

Clarification: if a question or request is ambiguous or missing key details, ask a brief, polite clarifying question rather than guessing wildly.

Sensitive topics: stay neutral and balanced on political, religious, or other controversial/divisive topics — present different perspectives fairly rather than pushing one side. Do not provide medical diagnoses or dangerous/harmful instructions (e.g. weapons, drugs, self-harm). For health or legal questions, share general, safe, well-established information and gently suggest consulting a qualified professional for anything serious, without being preachy or repetitive about it. Be supportive and encouraging without exaggerating or being saccharine.

Your overall goal: give answers that are useful, accurate, and easy to understand, in a tone that feels natural, warm, and trustworthy.

Follow-up suggestions: after a substantive reply (not for simple greetings or one-word acknowledgements), think of up to 3 short, natural follow-up actions the user might want next — things like continuing the idea, going deeper on one part, or a related next step. Append them at the very end of your reply as a single hidden line in EXACTLY this format (nothing else on that line):
SUGGESTIONS::suggestion one|suggestion two|suggestion three
Each suggestion must be very short (3-6 words), written from the user's point of view as something THEY would say next (e.g. "لخّص هذا بجدول", "اشرح النقطة الثانية أكثر", "اكتب نسخة أقصر"), in the same language as your reply. If nothing meaningful fits, omit this line entirely. Never mention this line or its format in the visible part of your reply.

Special case — identity: if the user asks who you are, who made/built/developed/created you, or similar (e.g. "من أنت", "من طورك", "مين سواك", "من صممك", "who are you", "who made you", "who developed you"), answer warmly and briefly, and state clearly that you were developed by tech expert Atiq Al-Jathwah (عتيق الجذوة) and Abdulmajeed Al-Jahmi (عبدالمجيد الجهمي). If replying in Arabic, include this exact phrase naturally in your answer: "تم التطوير بواسطة الخبير التقني: عتيق الجذوة وعبدالمجيد الجهمي". If replying in English, say you were developed by tech expert Atiq Al-Jathwah and Abdulmajeed Al-Jahmi.

Special case — images: if (and only if) the user is asking you to draw, create, generate, design, or imagine an image/picture/logo/artwork/illustration, do NOT write a normal reply. Instead reply with EXACTLY one line and nothing else, in this exact format:
IMAGE_REQUEST::<a short, vivid, detailed prompt in English describing the image, translated and enhanced from the user's request>
Do not add any greeting, explanation, or extra text before or after that line. For every other kind of message, ignore this rule and reply normally as instructed above.`;

const TRANSLATE_PROMPT = `You turn a user's image request (in Arabic or English) into a short, vivid, detailed image-generation prompt in English. Reply with ONLY the prompt text, nothing else — no quotes, no explanation, no prefix.`;

const GROQ_MODEL = "llama-3.3-70b-versatile";
const NVIDIA_MODEL = "z-ai/glm-5.2";

async function callGroq(apiKey, systemPrompt, messages, maxTokens) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.5,
      max_tokens: maxTokens,
    }),
  });
}

async function callNvidia(apiKey, systemPrompt, messages, maxTokens) {
  return fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.5,
      max_tokens: maxTokens,
    }),
  });
}

// يحاول Groq أولاً؛ لو رجع 429 (ازدحام) أو خطأ خادم (5xx) أو فشل الاتصال، يجرّب NVIDIA تلقائياً كخطة احتياط
async function chatCompletion(groqKey, nvidiaKey, systemPrompt, messages, maxTokens) {
  let lastError = null;

  if (groqKey) {
    try {
      const res = await callGroq(groqKey, systemPrompt, messages, maxTokens);
      if (res.ok) return { ok: true, res, provider: "groq" };
      // خطأ غير قابل لإعادة المحاولة (مثل طلب خاطئ) — رجّعه فوراً بدون تحويل
      if (res.status !== 429 && res.status < 500) {
        return { ok: false, res, provider: "groq" };
      }
      lastError = { status: res.status, text: await res.text().catch(() => "") };
    } catch (e) {
      lastError = { status: 0, text: String(e) };
    }
  }

  if (nvidiaKey) {
    try {
      const res = await callNvidia(nvidiaKey, systemPrompt, messages, maxTokens);
      return { ok: res.ok, res, provider: "nvidia" };
    } catch (e) {
      lastError = { status: 0, text: String(e) };
    }
  }

  return { ok: false, res: null, provider: "none", error: lastError };
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

  const groqKey = process.env.GROQ_API_KEY;
  const nvidiaKey = process.env.NVIDIA_API_KEY; // اختياري — لو غير موجود، يشتغل بـ Groq بس مثل قبل

  if (!groqKey && !nvidiaKey) {
    res.status(500).json({
      error: "لا يوجد أي مفتاح API مضبوط (GROQ_API_KEY أو NVIDIA_API_KEY). راجع ملف README.",
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

      const result = await chatCompletion(groqKey, nvidiaKey, TRANSLATE_PROMPT, [{ role: "user", content: rawPrompt }], 150);

      if (!result.ok) {
        if (result.res?.status === 429) {
          res.status(429).json({ error: "الخدمة مزدحمة حالياً، حاول بعد دقيقة." });
          return;
        }
        res.status(result.res?.status || 502).json({ error: "خطأ من مزوّد النموذج" });
        return;
      }

      const data = await result.res.json();
      const enhancedPrompt = (data.choices?.[0]?.message?.content || rawPrompt).trim();
      res.status(200).json({ type: "image", prompt: enhancedPrompt });
      return;
    }

    // ===== وضع المحادثة العادي (+ اكتشاف تلقائي لطلبات الصور) =====
    const result = await chatCompletion(groqKey, nvidiaKey, SYSTEM_PROMPT, trimmed, 1024);

    if (!result.ok) {
      if (result.res?.status === 429) {
        res.status(429).json({
          error: "الخدمة مزدحمة حالياً (تجاوزنا الحد المجاني المؤقت). حاول بعد دقيقة.",
        });
        return;
      }
      res.status(result.res?.status || 502).json({ error: "خطأ من مزوّد النموذج" });
      return;
    }

    const data = await result.res.json();
    let reply = (data.choices?.[0]?.message?.content ?? "").trim();

    if (reply.startsWith("IMAGE_REQUEST::")) {
      const prompt = reply.slice("IMAGE_REQUEST::".length).trim();
      res.status(200).json({ type: "image", prompt: prompt || "a beautiful jasmine flower" });
      return;
    }

    let suggestions = [];
    const suggMatch = reply.match(/\n?SUGGESTIONS::(.+)$/);
    if (suggMatch) {
      suggestions = suggMatch[1]
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
      reply = reply.slice(0, suggMatch.index).trim();
    }

    res.status(200).json({ type: "text", reply, suggestions });
  } catch (err) {
    res.status(500).json({ error: "خطأ داخلي في الخادم", details: String(err) });
  }
};


import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import multer from "multer";

const app = express();
const upload = multer();

app.use(cors());
app.use(express.json({ limit: "200mb" }));

const API_KEY = process.env.GEMINI_API_KEY;

/* ===== SPLIT SRT ===== */
function splitSRT(text, maxBlock = 60) {
  const blocks = text.trim().split(/\n\n+/);
  const chunks = [];

  for (let i = 0; i < blocks.length; i += maxBlock) {
    chunks.push(blocks.slice(i, i + maxBlock).join("\n\n"));
  }

  return chunks;
}

/* ===== MERGE LINES ===== */
function mergeLinesInBlock(block) {
  const lines = block.split("\n");

  if (lines.length <= 3) return block;

  const index = lines[0];
  const time = lines[1];
  const text = lines.slice(2).join(" ").replace(/\s+/g, " ").trim();

  return `${index}\n${time}\n${text}`;
}

/* ===== MERGE SHORT SUBS ===== */
function smartMergeShortSubs(srt) {
  const blocks = srt.trim().split(/\n\n+/);
  const result = [];

  for (let i = 0; i < blocks.length; i++) {
    let cur = blocks[i].split("\n");
    let next = blocks[i + 1]?.split("\n");

    if (next && cur.slice(2).join(" ").length < 15) {
      const mergedText =
        cur.slice(2).join(" ") + " " + next.slice(2).join(" ");

      const mergedBlock = `${cur[0]}
${cur[1].split(" --> ")[0]} --> ${next[1].split(" --> ")[1]}
${mergedText.replace(/\s+/g, " ").trim()}`;

      result.push(mergedBlock);
      i++;
    } else {
      result.push(blocks[i]);
    }
  }

  return result.join("\n\n");
}

/* ===== CALL GEMINI ===== */
async function translateChunk(chunk) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: "Dịch toàn bộ phụ đề sang tiếng Việt, giữ nguyên số thứ tự và mốc thời gian."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: chunk }]
        }
      ],
      generationConfig: {
        temperature: 0.2
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }

  const data = await res.json();

  return data.candidates[0].content.parts[0].text;
}

/* ===== ROUTE ===== */
app.post("/", upload.single("file"), async (req, res) => {
  try {
    let srtText = "";

    if (req.file) {
      srtText = req.file.buffer.toString("utf-8");
    } else {
      srtText = req.body.srt || "";
    }

    const chunks = splitSRT(srtText, 60);

    let result = "";

    for (let i = 0; i < chunks.length; i++) {
      const translated = await translateChunk(chunks[i]);
      result += translated + "\n\n";
    }

    let merged = result
      .split(/\n\n+/)
      .map(mergeLinesInBlock)
      .join("\n\n");

    merged = smartMergeShortSubs(merged);

    res.json({ success: true, data: merged });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

export default app;

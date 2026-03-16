import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import multer from "multer";

const app = express();
const upload = multer();

app.use(cors());
app.use(express.json({ limit: "200mb" }));
app.use(express.static("public"));

/* ====== DÁN API KEY GEMINI CỦA BẠN Ở ĐÂY ====== */
// Lấy key tại: https://aistudio.google.com/
const API_KEY = "Dan_Gemini_api_key";
/* ============================================== */

function splitSRT(text, maxBlock = 60) {
  const blocks = text.trim().split(/\n\n+/);
  const chunks =[];
  for (let i = 0; i < blocks.length; i += maxBlock) {
    chunks.push(blocks.slice(i, i + maxBlock).join("\n\n"));
  }
  return chunks;
}

/* ===== GỘP DÒNG TRONG 1 SUB ===== */
function mergeLinesInBlock(block) {
  const lines = block.split("\n");
  if (lines.length <= 3) return block;

  const index = lines[0];
  const time = lines[1];
  const text = lines.slice(2).join(" ").replace(/\s+/g, " ").trim();

  return `${index}\n${time}\n${text}`;
}

/* ===== GỘP CÂU NGẮN GIỮA CÁC SUB ===== */
function smartMergeShortSubs(srt) {
  const blocks = srt.trim().split(/\n\n+/);
  const result =[];

  for (let i = 0; i < blocks.length; i++) {
    let cur = blocks[i].split("\n");
    let next = blocks[i + 1]?.split("\n");

    if (
      next &&
      cur.slice(2).join(" ").length < 15 // câu quá ngắn
    ) {
      const mergedText =
        cur.slice(2).join(" ") + " " + next.slice(2).join(" ");

      const mergedBlock = `${cur[0]}
${cur[1].split(" --> ")[0]} --> ${next[1].split(" --> ")[1]}
${mergedText.replace(/\s+/g, " ").trim()}`;

      result.push(mergedBlock);
      i++; // skip next
    } else {
      result.push(blocks[i]);
    }
  }

  return result.join("\n\n");
}

/* ===== GỌI API GEMINI 2.5 FLASH ===== */
async function translateChunk(chunk) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY // Header chứa API Key của Google
    },
    body: JSON.stringify({
      systemInstruction: {
        parts:[
          {
            text: "Dịch toàn bộ phụ đề sang tiếng Việt, giữ nguyên số thứ tự và mốc thời gian, không thêm chú thích."
          }
        ]
      },
      contents:[
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
    console.error("API ERROR:", err);
    throw new Error(`API loi: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  
  // Kiểm tra xem Gemini có trả về kết quả không (phòng trường hợp bị chặn do safety filter)
  if (!data.candidates || data.candidates.length === 0) {
    console.error("Empty response or blocked by safety settings", data);
    throw new Error("Không nhận được kết quả dịch từ Gemini.");
  }

  return data.candidates[0].content.parts[0].text;
}

app.post("/translate", upload.single("file"), async (req, res) => {
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
      console.log(`Da dich ${i + 1}/${chunks.length}`);
    }

    // gộp dòng trong từng sub
    let merged = result
      .split(/\n\n+/)
      .map(mergeLinesInBlock)
      .join("\n\n");

    // gộp các câu quá ngắn để tránh TTS đè giọng
    merged = smartMergeShortSubs(merged);

    res.json({ success: true, data: merged });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: e.message });
  }
});

app.listen(3000, () => {
  console.log("Server chay tai http://localhost:3000");
       

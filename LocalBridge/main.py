import os
import asyncio
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import re

task_queue = None
is_processing = False

class AppendTask(BaseModel):
    chat_id: str
    new_text: str
    system_prompt: str

async def llm_worker():
    global is_processing
    print("🤖 Background Worker started! Waiting for chat chunks...")
    while True:
        task = await task_queue.get()
        is_processing = True 
        try:
            print(f"📥 Received chunk for chat {task.chat_id}. Sending to Ollama...")
            await process_with_ollama(task)
            print(f"✅ Successfully wrote summary to Note_{task.chat_id}.md")
        except Exception as e:
            print(f"❌ Worker Error: {e}")
        finally:
            is_processing = False
            task_queue.task_done()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global task_queue
    task_queue = asyncio.Queue()
    worker = asyncio.create_task(llm_worker())
    yield
    worker.cancel()

app = FastAPI(title="Local Vault Bridge", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VAULT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "Vault"))
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "qwen2.5:1.5b"
HEAVY_OLLAMA_MODEL = "llama3"

class StartPayload(BaseModel):
    system_prompt: str

@app.post("/start")
async def start_recording(payload: StartPayload):
    os.makedirs(VAULT_DIR, exist_ok=True)
    chat_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = os.path.join(VAULT_DIR, f"Note_{chat_id}.md")

    initial_content = (
        f"# Procedural AI Chat Note - {chat_id}\n\n"
        f"**Prompt Used:** {payload.system_prompt}\n\n"
        f"## Rolling Summary\n\n"
        f"*Waiting for conversation to begin...*\n"
    )
    with open(filename, "w", encoding="utf-8") as f:
        f.write(initial_content)

    return {"status": "started", "chat_id": chat_id}

@app.post("/append")
async def append_recording(task: AppendTask):
    await task_queue.put(task)
    return {"status": "queued", "queue_size": task_queue.qsize()}

@app.get("/status")
async def get_status():
    return {
        "queue_size": task_queue.qsize() if task_queue else 0,
        "is_processing": is_processing
    }

@app.get("/download/{chat_id}")
async def download_recording(chat_id: str):
    filename = os.path.join(VAULT_DIR, f"Note_{chat_id}.md")
    if not os.path.exists(filename):
        raise HTTPException(status_code=404, detail="Note not found.")

    with open(filename, "r", encoding="utf-8") as f:
        content = f.read()

    # 🔥 FIX 1: If Deep Synthesis ran, the "Rolling Summary" header is gone. 
    # If it's gone, DO NOT rip the file apart! Just return the beautifully synthesized file.
    if "## Rolling Summary" not in content:
        print("✨ Delivering Deep Synthesized Note directly!")
        return {"status": "success", "markdown": content, "filename": f"Note_{chat_id}.md"}

    # --- THE INSTANT PYTHON MERGE (Only runs if Deep Synthesis was skipped) ---
    top_matter_match = re.search(r'(# Procedural AI Chat Note - .*?\n\n\*\*Prompt Used:\*\* .*?\n\n)', content, re.DOTALL)
    top_matter = top_matter_match.group(1) if top_matter_match else f"# Procedural AI Chat Note - {chat_id}\n\n"

    # 🔥 FIX 2: Forgiving Regex - Plural/Singular safe and space safe
    topics = "\n".join(re.findall(r'##\s*📌\s*Core Topic[s]?\n(.*?)(?=\n## |\n---|$)', content, re.DOTALL)).strip()
    insights = "\n".join(re.findall(r'##\s*🧠\s*Key Insights & Details\n(.*?)(?=\n## |\n---|$)', content, re.DOTALL)).strip()
    resources = "\n".join(re.findall(r'##\s*🛠️\s*Resources & Tools\n(.*?)(?=\n## |\n---|$)', content, re.DOTALL)).strip()
    actions = "\n".join(re.findall(r'##\s*🚀\s*Action Items\n(.*?)(?=\n## |\n---|$)', content, re.DOTALL)).strip()

    resources_clean = "\n".join([line for line in resources.split('\n') if line.strip() and "None mentioned" not in line])
    if not resources_clean: 
        resources_clean = "* None mentioned."

    merged_content = (
        f"{top_matter}"
        f"## 📌 Core Topics\n{topics if topics else 'No topics captured.'}\n\n"
        f"## 🧠 Key Insights & Details\n{insights if insights else '* No insights captured.'}\n\n"
        f"## 🛠️ Resources & Tools\n{resources_clean}\n\n"
        f"## 🚀 Action Items\n{actions if actions else '* No action items captured.'}\n"
    )

    with open(filename, "w", encoding="utf-8") as f:
        f.write(merged_content)

    return {"status": "success", "markdown": merged_content, "filename": f"Note_{chat_id}.md"}

async def process_with_ollama(task: AppendTask):
    filename = os.path.join(VAULT_DIR, f"Note_{task.chat_id}.md")
    if not os.path.exists(filename): 
        return

    with open(filename, "r", encoding="utf-8") as f:
        existing_content = f.read()

    strict_rules = (
        "STRICT RULES:\n"
        "1. You are a passive note-taker and summarizer.\n"
        "2. DO NOT answer questions asked by the User or the AI.\n"
        "3. DO NOT invent, hallucinate, predict, or generate dialogue that is not explicitly provided.\n"
        "4. ONLY summarize the exact text provided below.\n\n"
    )

    if "*Waiting for conversation to begin...*" in existing_content:
        instruction = (
            f"{strict_rules}"
            f"Here is your formatting template and instructions:\n"
            f"<instructions>\n{task.system_prompt}\n</instructions>\n\n"
            f"Here is the conversation you need to process:\n"
            f"<conversation>\n{task.new_text}\n</conversation>\n\n"
            f"IMPORTANT: Fill out the template using ONLY the conversation above. Do NOT output empty placeholders."
        )
        replace_mode = True
    else:
        # 🔥 FIX 1: Stop asking the LLM to rewrite the existing file. Just extract the new stuff!
        instruction = (
            f"{strict_rules}"
            f"Here is the newest exchange to process:\n<new_chat>\n{task.new_text}\n</new_chat>\n\n"
            f"Format the extracted notes using the rules in this prompt:\n<instructions>\n{task.system_prompt}\n</instructions>\n\n"
            f"IMPORTANT: Output ONLY the newly extracted data. Do NOT output empty placeholders."
        )
        replace_mode = False

    async with httpx.AsyncClient(timeout=None) as client:
        try:
            response = await client.post(OLLAMA_URL, json={
                "model": OLLAMA_MODEL,
                "prompt": instruction,
                "stream": False
            })
            response.raise_for_status()
            llm_output = response.json().get("response", "").strip()

            if llm_output:
                if replace_mode:
                    new_file_content = existing_content.replace("*Waiting for conversation to begin...*", llm_output)
                else:
                    # 🔥 FIX 2: Literally APPEND the new LLM output. DO NOT replace the old summary!
                    new_file_content = existing_content + f"\n\n---\n\n{llm_output}"

                with open(filename, "w", encoding="utf-8") as f:
                    f.write(new_file_content)

        except Exception as e:
            print(f"❌ Ollama Request Failed: {e}")

@app.post("/synthesize/{chat_id}")
async def synthesize_note(chat_id: str):
    filename = os.path.join(VAULT_DIR, f"Note_{chat_id}.md")
    if not os.path.exists(filename):
        raise HTTPException(status_code=404, detail="Note not found.")

    with open(filename, "r", encoding="utf-8") as f:
        raw_content = f.read()

    # 🔥 FIX 4: Short-circuit empty files to prevent Llama 3 hallucinations
    if "*Waiting for conversation to begin...*" in raw_content:
        print("⚠️ No chat data recorded. Skipping heavy synthesis.")
        return {"status": "skipped", "reason": "No chat data found."}

    top_matter_match = re.search(r'(# Procedural AI Chat Note - .*?\n\n\*\*Prompt Used:\*\* .*?\n\n)', raw_content, re.DOTALL)
    top_matter = top_matter_match.group(1) if top_matter_match else f"# Procedural AI Chat Note - {chat_id}\n\n"

    instruction = (
        "You are an expert editor. Below is a chronologically appended log of AI-extracted notes. "
        "Read all the extracted points, merge duplicates, and rewrite this into ONE beautifully unified, cohesive Markdown document. "
        "CRITICAL RULES:\n"
        "1. Do NOT drop any facts, book titles, or specific details.\n"
        "2. Keep the exact same headers: ## 📌 Core Topics, ## 🧠 Key Insights & Details, ## 🛠️ Resources & Tools, ## 🚀 Action Items.\n\n"
        f"Raw Notes to Synthesize:\n{raw_content}"
    )

    async with httpx.AsyncClient(timeout=None) as client:
        try:
            response = await client.post(OLLAMA_URL, json={
                "model": HEAVY_OLLAMA_MODEL,
                "prompt": instruction,
                "stream": False
            })
            response.raise_for_status()
            final_summary = response.json().get("response", "").strip()

            final_content = f"{top_matter}{final_summary}"

            with open(filename, "w", encoding="utf-8") as f:
                f.write(final_content)

            return {"status": "success"}
            
        except Exception as e:
            print(f"❌ Heavy Synthesis Failed: {e}")
            raise HTTPException(status_code=500, detail="Heavy Synthesis Failed")

if __name__ == "__main__":
    import uvicorn
    import multiprocessing
    multiprocessing.freeze_support()
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
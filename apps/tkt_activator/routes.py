from fastapi import APIRouter, Request
from apps.tkt_activator import tkt_cli, telegram

router = APIRouter()

@router.post("/callback")
async def callback(req: Request):
    update = await req.json()
    cb = update.get("callback_query")
    if not cb: return {"ok": False, "reason": "no callback_query"}

    cb_id = cb["id"]
    data = cb.get("data", "")
    chat_id = cb["message"]["chat"]["id"]
    msg_id = cb["message"]["message_id"]

    action, _, sid = data.partition(":")
    if not sid.isdigit():
        telegram.answer_callback(cb_id, "Invalid action")
        return {"ok": False}
    tid = sid

    summary = ""
    if action == "done":
        res = tkt_cli.run_tkt(["done", tid])
        summary = f"✅ done #{tid}" if res["ok"] else f"⚠️ {res.get('stderr','error')}"
    elif action == "snooze1d":
        res = tkt_cli.run_tkt(["defer", tid, "+1d"])
        summary = f"😴 snoozed #{tid} +1d" if res["ok"] else f"⚠️ {res.get('stderr','error')}"
    elif action == "tmrw9":
        res = tkt_cli.run_tkt(["defer", tid, "tomorrow 9am"])
        summary = f"📅 #{tid} → tomorrow 9am" if res["ok"] else f"⚠️ {res.get('stderr','error')}"
    else:
        telegram.answer_callback(cb_id, "Unknown action")
        return {"ok": False}

    telegram.answer_callback(cb_id, summary)
    telegram.remove_keyboard(chat_id, msg_id, new_text=summary)
    return {"ok": True}

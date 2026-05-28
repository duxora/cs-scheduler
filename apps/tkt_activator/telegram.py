import os, httpx

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
BASE = f"https://api.telegram.org/bot{TOKEN}"

def answer_callback(cb_id: str, text: str = "") -> None:
    httpx.post(f"{BASE}/answerCallbackQuery", json={"callback_query_id": cb_id, "text": text}, timeout=5)

def remove_keyboard(chat_id: int, message_id: int, new_text: str | None = None) -> None:
    if new_text is not None:
        httpx.post(f"{BASE}/editMessageText", json={
            "chat_id": chat_id, "message_id": message_id, "text": new_text, "parse_mode": "Markdown",
            "reply_markup": {"inline_keyboard": []},
        }, timeout=5)
    else:
        httpx.post(f"{BASE}/editMessageReplyMarkup", json={
            "chat_id": chat_id, "message_id": message_id, "reply_markup": {"inline_keyboard": []},
        }, timeout=5)

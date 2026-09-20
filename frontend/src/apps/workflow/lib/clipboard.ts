/** Clipboard helper shared by copy-to-clipboard affordances (never a POST). */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // clipboard API unavailable (insecure context, permission denied) - silently no-op,
    // the button label already tells the user what would have been copied.
  }
}

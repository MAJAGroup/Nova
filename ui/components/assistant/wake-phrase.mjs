// Finds the wake phrase ("Hey Nova") at the start of a transcript.
// Speech-to-text spells the name a few ways, so near spellings count.

const GREETING = /^(?:hey|hay|hi|hiya|okay|ok|a|yo)$/;
const NAME = /^(?:nova|novah|nover|knova|noba)$/;

function words(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9']+/g, " ").trim().split(" ").filter(Boolean);
}

// Returns null when the transcript doesn't start with the wake phrase,
// otherwise the command after it ("" when the phrase was said on its own).
export function extractWakeCommand(text) {
  const source = String(text || "");
  const list = words(source);
  let index = 0;
  if (GREETING.test(list[0] || "")) index = 1;
  if (!NAME.test(list[index] || "")) return null;
  // Cut the original text after the name, keeping its punctuation and case.
  const pattern = new RegExp("^\\W*" + (index ? "\\w+\\W+" : "") + "\\w+[\\s,.:;!?-]*", "i");
  return source.replace(pattern, "").trim();
}

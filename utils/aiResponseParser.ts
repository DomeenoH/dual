
import type { NotepadAction, NotepadUpdatePayload, ParsedAIResponse } from '../types';

export type { ParsedAIResponse };

/**
 * Attempts to sanitize and parse a JSON string that might contain common LLM errors
 * like trailing commas or comments.
 */
const robustJsonParse = (jsonStr: string): any => {
  if (!jsonStr) return null;
  
  // 1. Try standard parse first
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Continue to repair strategies
  }

  let cleaned = jsonStr;

  // 2. Remove trailing commas (e.g., {"a": 1,} -> {"a": 1})
  // This regex finds a comma followed by whitespace and a closing brace/bracket
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Continue
  }

  // 3. Remove potential comments (// ... or /* ... */)
  // Note: This is aggressive and might strip URLs, so we use it as a fallback
  try {
    const noComments = cleaned
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    return JSON.parse(noComments);
  } catch (e) {
    // Final failure
    return null;
  }
};

export const parseAIResponse = (responseText: string): ParsedAIResponse => {
  let spokenText = responseText;
  let notepadModifications: NotepadAction[] = [];
  let discussionShouldEnd = false;
  let parsingError: string | undefined = undefined;

  // Strategy 1: Look for Markdown Code Blocks
  // We prioritize the *last* code block as it typically contains the final instructions
  const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  const matches = [...responseText.matchAll(jsonBlockRegex)];
  
  let jsonCandidate: string | null = null;
  let textToRemove: string | null = null;

  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    jsonCandidate = lastMatch[1];
    textToRemove = lastMatch[0];
  } else {
    // Strategy 2: Heuristic Search
    // If no code blocks, look for a JSON object structure at the end of the message
    // that contains our specific keys.
    const knownKeys = ['"notepad_modifications"', '"discussion_complete"'];
    let lastKeyIndex = -1;
    
    for (const key of knownKeys) {
      const idx = responseText.lastIndexOf(key);
      if (idx > lastKeyIndex) lastKeyIndex = idx;
    }

    if (lastKeyIndex !== -1) {
      // Look for the opening brace of the object containing this key
      const openBraceIndex = responseText.lastIndexOf('{', lastKeyIndex);
      // Look for the closing brace
      const closeBraceIndex = responseText.lastIndexOf('}');
      
      if (openBraceIndex !== -1 && closeBraceIndex !== -1 && closeBraceIndex > openBraceIndex) {
        // Basic check to ensure it looks like a complete object
        jsonCandidate = responseText.substring(openBraceIndex, closeBraceIndex + 1);
        textToRemove = jsonCandidate;
      }
    }
  }

  if (jsonCandidate) {
    const parsed = robustJsonParse(jsonCandidate);

    if (parsed && typeof parsed === 'object') {
      // Extraction Successful
      if (Array.isArray(parsed.notepad_modifications)) {
        notepadModifications = parsed.notepad_modifications;
      }
      if (typeof parsed.discussion_complete === 'boolean') {
        discussionShouldEnd = parsed.discussion_complete;
      }

      // Remove the JSON part from spoken text
      if (textToRemove) {
        // If we used regex, we want to remove the specific match instance
        // If we used heuristic, we remove that substring
        // To be safe against duplicate substrings, we try to remove from the end if possible
        if (spokenText.endsWith(textToRemove)) {
            spokenText = spokenText.slice(0, -textToRemove.length).trim();
        } else {
            // Fallback to simple replace, but might replace wrong instance if text is repetitive
            spokenText = spokenText.replace(textToRemove, '').trim();
        }
      }
    } else {
      // Parsing Failed
      // Only report error if we found a code block (user likely intended JSON)
      if (matches.length > 0) {
        console.warn("Found code block but failed to parse JSON:", jsonCandidate);
        parsingError = "Failed to parse AI JSON response.";
      }
    }
  }

  // Construct status text for the UI based on actions found
  let notepadActionText = notepadModifications.length > 0 ? `修改了记事本 (${notepadModifications.length} 项操作)` : "";
  let discussionActionText = discussionShouldEnd ? "建议结束讨论" : "";

  // Handle empty spoken text scenarios (AI only performed actions)
  if (!spokenText.trim()) {
    if (notepadActionText && discussionActionText) {
      spokenText = `(AI ${notepadActionText}并${discussionActionText})`;
    } else if (notepadActionText) {
      spokenText = `(AI ${notepadActionText})`;
    } else if (discussionActionText) {
      spokenText = `(AI ${discussionActionText})`;
    } else if (!parsingError && (notepadModifications.length > 0 || discussionShouldEnd)) {
        // If we have actions but no text and no error, generic message
        spokenText = "(AI process complete)";
    } else if (!parsingError && matches.length === 0) {
       // No JSON found at all, and no text? Unlikely, but fallback.
       // spokenText remains empty string, handled by UI as empty bubble or handled upstream
    }
  }

  const notepadUpdate: NotepadUpdatePayload = notepadModifications.length > 0 || parsingError
    ? { modifications: notepadModifications.length > 0 ? notepadModifications : undefined, error: parsingError }
    : null;

  return { spokenText, notepadUpdate, discussionShouldEnd };
};

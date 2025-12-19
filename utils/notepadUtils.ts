
import { NotepadAction } from '../types';
import { escapeRegExp } from './commonUtils';

/**
 * Robustly finds the line index of a Markdown header or a bolded line that looks like a header.
 * Handles variations in whitespace, casing, quotes, colons, and minor AI hallucinations.
 */
const findHeaderLineIndex = (lines: string[], targetHeader: string): { index: number; level: number } => {
  if (!targetHeader) return { index: -1, level: 0 };

  // 1. Basic Normalization Helper
  const normalize = (s: string) => {
    return s.replace(/^[#\s*_-]+/, '') // Strip leading Markdown markers (hashes, spaces, asterisks)
      .replace(/[*_~]+$/, '')        // Strip trailing Markdown markers
      .trim()
      .toLowerCase()
      .replace(/[“”]/g, '"')         // Normalize smart double quotes
      .replace(/[‘’]/g, "'")         // Normalize smart single quotes
      .replace(/[：]/g, ":")         // Normalize Chinese colon
      .replace(/[:：.。.]$/, '')      // Remove trailing punctuation
      .trim();
  };

  // 2. Super Aggressive Cleaning Helper (Keep only meaningful chars)
  const superClean = (s: string) => {
    return s.replace(/[^\w\u4e00-\u9fa5]/g, '');
  };

  const normalizedTarget = normalize(targetHeader);
  const superCleanTarget = superClean(normalizedTarget);

  if (!normalizedTarget && !superCleanTarget) return { index: -1, level: 0 };

  // Loop through lines to find a match
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let headerText = "";
    let level = 0;

    // A. Check for standard Markdown header (#)
    const headerMatch = line.match(/^(\s*)(#+)\s*(.*)$/);
    if (headerMatch) {
      level = headerMatch[2].length;
      headerText = headerMatch[3].trim();
    } 
    // B. Check for Bolded lines as potential headers (Common AI fallback)
    else {
      const boldMatch = line.match(/^(\*\*|__)(.*?)(\*\*|__)\s*$/);
      if (boldMatch) {
        level = 4; // Treat bold as a low-level header (e.g., h4)
        headerText = boldMatch[2].trim();
      }
      // C. Check if the line content itself is very similar to the target header text
      // (Even if it lacks Markdown formatting)
      else if (line.length < 100) { // Only check short lines as potential headers
        headerText = line;
        level = 3; // Assume middle level
      }
    }

    if (headerText) {
      const normalizedHeader = normalize(headerText);
      const superCleanHeader = superClean(normalizedHeader);

      // 1. Exact match (after normalization)
      if (normalizedHeader === normalizedTarget) {
        return { index: i, level };
      }
      
      // 2. Substring match (Target in Header or vice versa)
      if (normalizedTarget.length > 2) {
        if (normalizedHeader.includes(normalizedTarget) || normalizedTarget.includes(normalizedHeader)) {
          return { index: i, level };
        }
      }

      // 3. Super aggressive match (ignoring all punctuation/quotes/separators)
      if (superCleanTarget.length > 2 && superCleanHeader.length > 2) {
        if (superCleanHeader === superCleanTarget || 
            superCleanHeader.includes(superCleanTarget) || 
            superCleanTarget.includes(superCleanHeader)) {
          return { index: i, level };
        }
      }
    }
  }

  // If we didn't find anything with the above patterns, 
  // do one last pass looking for the string anywhere in the document on a non-empty line
  // (Least restrictive fallback)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase();
    if (line && (line.includes(normalizedTarget) || normalizedTarget.includes(line))) {
       return { index: i, level: 2 };
    }
  }

  return { index: -1, level: 0 };
};

export const applyNotepadModifications = (currentContent: string, modifications: NotepadAction[]): { newContent: string; errors: string[] } => {
  let newContent = currentContent;
  const errors: string[] = [];

  modifications.forEach((mod, index) => {
    const lines = newContent.split('\n');
    const actionNum = index + 1;

    switch (mod.action) {
      case 'replace_all':
        newContent = mod.content;
        break;
      case 'append':
        newContent = newContent + (newContent.endsWith('\n') ? '' : '\n') + mod.content;
        break;
      case 'prepend':
        newContent = mod.content + (mod.content.endsWith('\n') ? '' : '\n') + newContent;
        break;
      case 'replace_section': {
        const { index: startLineIndex, level: headerLevel } = findHeaderLineIndex(lines, mod.header);

        if (startLineIndex === -1) {
          errors.push(`操作 ${actionNum} ("replace_section") 失败: 未找到标题 "${mod.header}"。`);
          break;
        }

        let endLineIndex = lines.length;
        // Find the end (next header of same or higher importance, i.e., level <= current)
        for (let i = startLineIndex + 1; i < lines.length; i++) {
          const match = lines[i].trim().match(/^(#+)\s/);
          if (match) {
            const currentLevel = match[1].length;
            if (currentLevel <= headerLevel) {
              endLineIndex = i;
              break;
            }
          }
        }

        const before = lines.slice(0, startLineIndex + 1); // Keep the header line
        const after = lines.slice(endLineIndex); // Content after the section
        
        const contentToInsert = mod.content.startsWith('\n') ? mod.content : '\n' + mod.content;
        const finalContent = [...before, contentToInsert, ...after].join('\n');
        newContent = finalContent.replace(/\n{3,}/g, '\n\n');
        break;
      }
      case 'append_to_section': {
        const { index: startLineIndex, level: headerLevel } = findHeaderLineIndex(lines, mod.header);

        if (startLineIndex === -1) {
          errors.push(`操作 ${actionNum} ("append_to_section") 失败: 未找到标题 "${mod.header}"。`);
          break;
        }

        let insertionLineIndex = lines.length;
        // Find the insertion point (start of next header of same or higher level, or end of doc)
        for (let i = startLineIndex + 1; i < lines.length; i++) {
          const match = lines[i].trim().match(/^(#+)\s/);
          if (match) {
            const currentLevel = match[1].length;
            if (currentLevel <= headerLevel) {
              insertionLineIndex = i;
              break;
            }
          }
        }

        const before = lines.slice(0, insertionLineIndex);
        const after = lines.slice(insertionLineIndex);

        // Ensure newline separation
        const lastLineOfSection = before[before.length - 1];
        let contentToInsert = mod.content;
        if (lastLineOfSection && lastLineOfSection.trim() !== '') {
          contentToInsert = '\n' + contentToInsert;
        }
        
        const finalContent = [...before, contentToInsert, ...after].join('\n');
        newContent = finalContent.replace(/\n{3,}/g, '\n\n');
        break;
      }
      case 'search_and_replace': {
        const safeSearchString = escapeRegExp(mod.find);
        if (!newContent.includes(mod.find) && !mod.all) {
           errors.push(`操作 ${actionNum} ("search_and_replace") 警告: 未找到文本 "${mod.find.substring(0, 20)}..."`);
        }
        
        if (mod.all) {
          const regex = new RegExp(safeSearchString, 'g');
          newContent = newContent.replace(regex, mod.replacement);
        } else {
          newContent = newContent.replace(safeSearchString, mod.replacement);
        }
        break;
      }
    }
  });

  return { newContent, errors };
};

export const formatNotepadContentForAI = (content: string): string => {
  if (!content.trim()) return ""; 
  return content;
};

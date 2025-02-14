import {hljsLangAliasMap, hljsSubLangMap} from './generated/hljs-lang-alias-map';
import {fileNameMap, langNameMap} from './language-map';


// Global flags
const prioritizeFileName = true; // Give priority to file names over language names
const autoDetectWhenNoLanguage = true; // Auto-detection when no language is specified
const autoDetectWhenNoExtension = true; // Auto-detection for files with no extension
const autoDetectWhenUnknownLanguage = true; // Auto-detection when unknown language


// highlight.js
import hljs from 'highlight.js/lib/core';



//
// Helpers
//

function getRecordValueOr<K extends PropertyKey, V, D>(record: Record<K, V>, key: K, defaultValue: D): V | D {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : defaultValue;
}

function getRecordValue<K extends PropertyKey, V>(record: Record<K, V>, key: K): V | undefined {
  return getRecordValueOr(record, key, undefined);
}

function getPathName(path: string): string {
  return new URL(path, location.href).pathname;
}

function getFileName(url: string): string {
  return url.substring(url.lastIndexOf('/') + 1);
}

function getFileExtension(fileName: string): string {
  const pos = fileName.lastIndexOf('.');
  return (pos < 0) ? '' : fileName.substring(pos + 1);
}

function removePrefix(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.substring(prefix.length) : text;
}

function decodeHtml(html: string): string {
  const doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + html, 'text/html');
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return doc.body.textContent!; // 'textContent' of 'body' is not null
}



//
// Dynamic Synchronous Highlight.js Language Loader
//

function loadHljsLanguageSync(langId: string): void {
  const pathName = getPathName(`${codeHighlighterHljsPath}/languages/${langId}.min.js`);

  const xhr = new XMLHttpRequest();
  xhr.open('GET', pathName, false);
  xhr.send();
  if(xhr.readyState === xhr.DONE && xhr.status === 200) {
    Function('hljs', '"use strict";' + xhr.responseText)(hljs);
  }
}


//
// HTML Line by Line Splitter
//

function splitHtmlTagsLineByLine(html: string): string[] {
  const openedTags: string[] = [];
  const closingTags: string[] = [];

  let index = 0;
  let unclosedTags = '';
  const lines: string[] = [];

  const re = new RegExp(/<\/?(\w+)[^>]*>|\n|\r\n?/g);
  let match;

  while((match = re.exec(html))) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const matched = match[0]!; // 'match[0]' is always defined

    if(matched.charAt(0) === '<') {
      if(matched.charAt(1) === '/') {
        // Closing tag
        console.assert(closingTags.length > 0, 'splitHtmlTagsLineByLine: Too many closing tags');
        openedTags.pop();
        closingTags.shift();
      }
      else {
        // Opening tag
        openedTags.push(matched);
        closingTags.unshift(`</${match[1]}>`);
      }
    }
    else {
      // End of the line
      lines.push(unclosedTags + html.substring(index, match.index) + closingTags.join(''));
      index = re.lastIndex;
      unclosedTags = openedTags.join('');
    }
  }

  // Last line
  lines.push(unclosedTags + html.substring(index));

  console.assert(closingTags.length === 0, 'splitHtmlTagsLineByLine: Too few closing tags');

  return lines;
}


//
// Language Loader
//

class Language {
  public readonly id: string | string[];

  constructor(code:string, langName?: string, fileNameOrUrl?: string) {
    this.id = Language.getId(code, langName, fileNameOrUrl);
    this.apply(id =>
      console.info(`Code Highlighter: Detected language ID '${id}'`)
    );
  }

  loadLanguage(): void {
    this.apply(id =>
      Language.loadLanguageWithSubLang(id)
    );
  }

  private apply(func: (id: string) => void): void {
    const ids = Array.isArray(this.id) ? this.id : [this.id];
    ids.forEach(func);
  }

  private static autoDetect(code: string, enable: boolean): string | string[] {
    // Auto-detection in Hightlight.js often takes a long time,
    // so use the plugin's own auto-detection

    if(!enable) {
      return 'plaintext';
    }

    if(code.startsWith('<')) {
      return 'xml';
    }

    if(code.startsWith('{')) {
      return 'json';
    }

    return [
      'bash',
      'ini',
      'javascript',
    ];
  }

  private static getId(code: string, langName: string | undefined, fileNameOrUrl: string | undefined): string | string[] {
    const useFileName = prioritizeFileName || !langName;

    if(useFileName && fileNameOrUrl) {
      let fileName = getFileName(fileNameOrUrl);

      console.info(`Code Highlighter: Detected file name '${fileName}'`)

      fileName = fileName.toLowerCase();
      langName = getRecordValue(fileNameMap, fileName) ?? getFileExtension(fileName);
      if(!langName) {
        return Language.autoDetect(code, autoDetectWhenNoExtension);
      }
    }

    if(!langName) {
      return Language.autoDetect(code, autoDetectWhenNoLanguage);
    }

    console.info(`Code Highlighter: Detected language name '${langName}'`)

    langName = langName.toLowerCase();
    langName = getRecordValueOr(langNameMap, langName, langName);

    const langId = getRecordValue(hljsLangAliasMap, langName);
    if(!langId) {
      return Language.autoDetect(code, autoDetectWhenUnknownLanguage);
    }

    return langId;
  }

  private static loadLanguageWithSubLang(langId: string): void {
    if(hljs.getLanguage(langId)) {
      return;
    }

    console.info(`Code Highlighter: Loading language '${langId}'`);
    loadHljsLanguageSync(langId);

    if(!hljs.getLanguage(langId)) {
      console.error(`Code Highlighter: Failed to load language '${langId}'`);
      return;
    }

    const subLangs = getRecordValue(hljsSubLangMap, langId);
    if(subLangs) {
      for(const subLang of subLangs) {
        console.info(`Code Highlighter: Detected sub-language ID '${subLang}'`);
        Language.loadLanguageWithSubLang(subLang);
      }
    }
  }
}


//
// Line Number Class
//

class LineNumber {
  public readonly enable: boolean;
  public readonly start: number;

  constructor(numLines?: number | boolean) {
    if(typeof numLines === 'number') {
      this.enable = true;
      this.start = numLines;
    }
    else {
      this.enable = !!numLines;
      this.start = 1;
    }
  }
}


//
// Highlighter Core
//

function hljsHighlight(code: string, lang: Language): string {
  lang.loadLanguage();

  try {
    let result;
    let type;
    if(Array.isArray(lang.id)) {
      result = hljs.highlightAuto(code, lang.id);
      type = 'Auto-highlighted';
    }
    else {
      result = hljs.highlight(code, {
        language: lang.id,
        ignoreIllegals: true
      });
      type = 'Highlighted';
    }
    const langName = result.language ?? 'plaintext';
    console.info(`Code Highlighter: ${type} language ID '${langName}'`);
    return result.value;
  }
  catch(err) {
    if(err instanceof Error) {
      console.error(`Code Highlighter: ${err.message}`);
    }
    return code;
  }
}

function addHighlightRelatedTags(code: string, lineNum: LineNumber, avoidSpan?: boolean): string {
  if(avoidSpan) {
    // Replace 'span' tags with 'div' tags because GitBucket doesn't like
    // nested 'span' tags when processing code comments in the diff view
    code = code.replace(/<(\/?)span\b/g, '<$1div');
  }

  // Wrapping the code in 'hljs' class
  code = `<span class="hljs">${code}</span>`;

  if(!lineNum.enable) {
    return code;
  }

  // Split HTML tags
  const lines = splitHtmlTagsLineByLine(code);

  // Add 'ol' and 'li' tags (Imitate google-code-prettify)

  code = lines.map( (codeLine, index) => {
    let lineValue = '';
    if(lineNum.start !== 1 && index === 0) {
      lineValue = `value="${lineNum.start}"`;
    }
    return `<li id="L${index + 1}" class="L${index % 10}" ${lineValue}>${codeLine}</li>`;
  }).join('');

  return `<ol class="linenums">${code}</ol>`;
}

function doHighlight(code: string, lang: Language, lineNum: LineNumber, avoidSpan?: boolean): string {
  // Apply highlighting
  code = hljsHighlight(code, lang);

  return addHighlightRelatedTags(code, lineNum, avoidSpan);
}


//
// Language Detector
//

function detectLanguage(elem: HTMLElement): string | undefined {
  // Get the language from the class name
  return elem.className.match(/\blang(?:uage)?-([^\s:]+)/)?.[1];
}

function detectFileNameOrUrl(elem: HTMLElement): string | undefined {
  // Get the filename from the class name
  // * This behavior is currently disabled
  //const match = elem.className.match(/\blang(?:uage)?-[^\s:]*:(\S+)/);
  //if(match) {
  //  return match[1];
  //}

  // Get the filename from dataset
  const fileNameOrUrl = elem.dataset['filename'] ?? elem.dataset['fileName'];
  if(fileNameOrUrl) {
    return fileNameOrUrl;
  }

  // In the blob view, get the filename from the pathname
  if(elem.classList.contains('blob')) {
    return decodeURIComponent(location.pathname);
  }

  return; // undefined
}

function detectLanguageId(code: string, elem: HTMLElement): Language {
  return new Language(code, detectLanguage(elem), detectFileNameOrUrl(elem));
}


//
// Line Number Detector
//

function detectLineNumber(elem: HTMLElement): LineNumber {
  // Get line number from the class name
  const lineNumsMatch = elem.className.match(/\blinenums\b(?::(\d+))?/);
  if(lineNumsMatch?.[1]) {
    return new LineNumber(+lineNumsMatch[1]);
  }
  return new LineNumber(lineNumsMatch ? true : false);
}


//
// Code Block Highlighter
//

function highlightElement(elem: HTMLElement): void {
  const isSearchResults = document.querySelector('form input[type="submit"][value="Search"]');
  if(isSearchResults) {
    // If it is a search results page, do not highlight and keep HTML tags
    elem.innerHTML = addHighlightRelatedTags(elem.innerHTML, detectLineNumber(elem));
  }
  else {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const code = elem.textContent!; // 'textContent' of 'Element' is not null
    elem.innerHTML = doHighlight(code, detectLanguageId(code, elem), detectLineNumber(elem));
  }
  elem.classList.add('prettyprinted', 'hljs'); // Prevent re-highlighting and apply highlight.js themes
}

function highlightCodeBlocks(root: HTMLElement | Document): void {
  const codeBlocks = root.querySelectorAll<HTMLPreElement>('pre.prettyprint:not(.prettyprinted)');
  for(const codeBlock of codeBlocks) {
    highlightElement(codeBlock);
  }
}


//
// Override Google Code Prettify Functions
//

function overrideFunctions(): void {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  prettyPrintOne = function(sourceCodeHtml: string, opt_langExtension?: string, opt_numberLines?: number | boolean): string {
    // Cancel adding a leading newline in gitbucket.js
    sourceCodeHtml = removePrefix(sourceCodeHtml, '\n');
    // Cancel HTML-encoding in gitbucket.js
    sourceCodeHtml = decodeHtml(sourceCodeHtml);

    return doHighlight(sourceCodeHtml, new Language(sourceCodeHtml, opt_langExtension), new LineNumber(opt_numberLines), true);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  prettyPrint = function(opt_whenDone?: () => void, opt_root?: HTMLElement | Document): void {
    const root = opt_root || document;
    highlightCodeBlocks(root);

    if(opt_whenDone) {
      opt_whenDone();
    }
  }
}


//
// Export
//

export function initializeHighlighting(): void {
  overrideFunctions();

  // Perform highlighting in the initialization process
  // This is because in Firefox, Gitbucket's 'updateHighlighting' function is called before 'prettyPrint' function is called
  highlightCodeBlocks(document);
}

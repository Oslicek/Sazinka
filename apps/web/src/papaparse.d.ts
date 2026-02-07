declare module 'papaparse' {
  namespace Papa {
    interface ParseConfig<T = unknown> {
      delimiter?: string;
      newline?: string;
      quoteChar?: string;
      escapeChar?: string;
      header?: boolean;
      transformHeader?: (header: string, index: number) => string;
      dynamicTyping?: boolean;
      preview?: number;
      encoding?: string;
      worker?: boolean;
      comments?: boolean | string;
      step?: (results: ParseResult<T>, parser: Parser) => void;
      complete?: (results: ParseResult<T>) => void;
      error?: (error: ParseError) => void;
      download?: boolean;
      downloadRequestHeaders?: Record<string, string>;
      skipEmptyLines?: boolean | 'greedy';
      chunk?: (results: ParseResult<T>, parser: Parser) => void;
      fastMode?: boolean;
      beforeFirstChunk?: (chunk: string) => string | void;
      withCredentials?: boolean;
      transform?: (value: string, field: string | number) => unknown;
      delimitersToGuess?: string[];
    }

    interface ParseResult<T = unknown> {
      data: T[];
      errors: ParseError[];
      meta: ParseMeta;
    }

    interface ParseError {
      type: string;
      code: string;
      message: string;
      row?: number;
    }

    interface ParseMeta {
      delimiter: string;
      linebreak: string;
      aborted: boolean;
      fields?: string[];
      truncated: boolean;
      cursor: number;
    }

    interface Parser {
      abort: () => void;
      pause: () => void;
      resume: () => void;
    }

    interface UnparseConfig {
      quotes?: boolean | boolean[];
      quoteChar?: string;
      escapeChar?: string;
      delimiter?: string;
      header?: boolean;
      newline?: string;
      skipEmptyLines?: boolean | 'greedy';
      columns?: string[];
    }

    function parse<T = unknown>(input: string | File, config?: ParseConfig<T>): ParseResult<T>;
    function unparse(data: unknown[] | { fields: string[]; data: unknown[][] }, config?: UnparseConfig): string;
  }

  export = Papa;
}

/**
 * Placeholder Database types.
 *
 * Replace by running:
 *
 *   pnpm db:start    # boot local Supabase
 *   pnpm db:types    # regenerates this file from the live schema
 *
 * The generated types are tight (every table, every column, every RPC).
 * Until then, this loose stub keeps the app compiling.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Loose row type — accepts any keys. Real types replace this on `pnpm db:types`.
type Row = Record<string, unknown>;

type AnyTable = {
  Row: Row;
  Insert: Row;
  Update: Row;
  Relationships: [];
};

type AnyFunction = {
  Args: Row;
  Returns: Row | Row[];
};

export type Database = {
  public: {
    Tables: {
      [key: string]: AnyTable;
    };
    Views: {
      [key: string]: AnyTable;
    };
    Functions: {
      [key: string]: AnyFunction;
    };
    Enums: {
      [key: string]: string;
    };
    CompositeTypes: {
      [key: string]: Row;
    };
  };
};

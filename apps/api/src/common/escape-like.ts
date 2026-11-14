// Escapes LIKE/ILIKE wildcards so user input matches literally ("50%" must not mean "50 + anything").
// Backslash is escaped first-class too, since it is Postgres' default LIKE escape character.
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

## Decisions

Reserve the entire byte cap before I/O: after existing size/remaining-budget checks,
the scanner passes stat.size to the reader and charges that same size. Root
.gitignore follows the same rule. Growth at the reader's second stat is rejected
before content I/O; failure after I/O keeps the full reservation. Zero-length files
use cap zero. Reader APIs, transport ownership and numeric budgets stay unchanged.

AstObservation keeps optional moduleSpecifier and gains optional
moduleSpecifierExact. True means its value is unchanged semantic text within the
existing 160 JavaScript UTF-16 code-unit limit. This is not a new byte limit.
Summary remains a separately bounded display projection. Compiler values use
TypeScript's decoded text. The structural tokenizer does not implement a partial
JavaScript escape decoder: escapes, multiline or template strings are unverified.
Oversized, secret-like/transformed and redaction-placeholder values are display-only.

Graph construction requires the exact flag to be true. False and legacy missing
flags produce unresolved observations with unverified-module-specifier reason,
rather than skipping observations or resolving a normalized prefix. Cache schema
moves from 3 to 4 so earlier AST data is reread/reparsed under the normal budgets.
No disk migration or cross-session persistence is introduced.

## Validation

Use actual Harness reader growth and post-read-failure probes; cover policy reads,
zero-size files and exact/remaining budget boundaries. Use independent static graph
expectations for double-space collisions, long common prefixes, redacted values,
legacy flags and escape decoding. A retained isolated source probe forces fallback
without TypeScript. The same probe uses the already installed official Harness
TypeScript 6.0.3 compiler API to validate compiler semantics; add no test dependency.
Record parser provenance rather than assuming TypeScript 7's native CLI exports
the compiler API. Preserve prior baselines and capture current source hashes.

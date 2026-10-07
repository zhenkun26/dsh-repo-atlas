## Scope

The existing Node 22/24 Ubuntu workflow remains unchanged. A separate Windows
Node 24 workflow has contents:read only and no secret, upload, deployment or
release steps. Its ordinary pull_request bootstrap is restricted to the exact
same-repository feature branch. Checkout uses the event's exact PR head SHA,
without persisted credentials, under a directory containing a space. Manual
runs check the event revision. Every existing minimum quality gate runs without
continue-on-error or selected test subsets.

## Commands and paths

The workspace compiler's existing JavaScript launcher and npm CLI entry supplied as npm_execpath by
`npm run` execute through process.execPath with shell:false and separate argv.
The artifact verifier requires the installed npm-cli.js entry and preserves the
fresh build, ignore-scripts, offline install and retained-artifact contract.
Direct verifier invocation without npm run fails explicitly; it never guesses a
Windows command shim or adds a shell. The safety lint converts separators only
for matching its original exact exceptions; enumeration and reported filenames
remain native. Real fixture subprocess regressions cover accepted paths and
forbidden near-miss names.

## Directory links and bytes

Directory-link tests use junction on Windows and dir on other systems. Both
exercise real links and the same rejection/unchanged-target assertions; Windows
file symlinks and elevation-dependent behavior are not claimed. Exact LF Git
fixtures set core.autocrlf=false only in their own temporary repositories. No
user or system Git/security setting changes.

## Evidence and limits

The existing replanning document owns status. The local gate record precedes
Windows CI, so it cannot claim Windows success. Native LSP and Web summaries
exclude private host paths, profile state, bootstrap authentication and raw logs.
A synthetic conversation rendering real tool outputs does not validate an LLM
turn, streaming, host cold restart, human review or formal stable support.

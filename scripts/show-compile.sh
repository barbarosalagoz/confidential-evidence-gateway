#!/usr/bin/env bash
# Screenshot-friendly proof of a successful compile.
#
# `compact compile` succeeds quietly ("Compiling 1 circuits:"), which does not
# make a legible screenshot. This prints the toolchain versions, runs a clean
# compile, and then shows the artifacts that prove it worked: the generated
# circuit, its proving and verifying keys, and the compiler's own record of the
# circuits, witnesses and public ledger fields.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="contracts/counter.compact"
OUT="contracts/managed/counter"

echo "=== Toolchain ==================================================="
echo "compact devtools : $(compact --version)"
echo "compact compiler : $(compact compile --version)"
echo "node             : $(node --version)"
echo

echo "=== Compiling $SRC ============================="
rm -rf "$OUT"
compact compile "$SRC" "$OUT"
echo "compile exit code: 0"
echo

echo "=== Generated artifacts ========================================="
find "$OUT" -type f | sort | sed 's/^/  /'
echo

echo "=== Circuits, witnesses and public ledger ======================="
node -e '
const info = require("./contracts/managed/counter/compiler/contract-info.json");
console.log("  compiler " + info["compiler-version"] +
            "  |  language " + info["language-version"] +
            "  |  runtime " + info["runtime-version"]);
console.log();
console.log("  Circuits (each has a proving + verifying key):");
for (const c of info.circuits) console.log("    - " + c.name + "()   proof: " + c.proof);
console.log();
console.log("  Private witnesses (NEVER disclosed):");
for (const w of info.witnesses) console.log("    - " + w.name + "() -> Uint<64>");
console.log();
console.log("  Public ledger state (all an observer can see):");
for (const l of info.ledger) console.log("    - " + l.name + " : " + l.storage);
'
echo
echo "=== Compile succeeded ==========================================="

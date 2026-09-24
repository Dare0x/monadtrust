// Minimal ambient types for solc-js, which ships no type declarations.
// We use only the standard JSON interface: solc.compile(input) -> JSON string.
declare module "solc" {
  const solc: {
    compile(input: string): string;
    version(): string;
  };
  export default solc;
}

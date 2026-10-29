declare module 'js-yaml' {
  export function load(str: string, opts?: Record<string, unknown>): unknown;
  const _default: { load: typeof load };
  export default _default;
}

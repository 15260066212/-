import type { ValidationResult } from './types.js';

export function required(input: string): ValidationResult {
  if (!input.trim()) {
    return { valid: false, error: '此项不能为空，请填写后重试' };
  }
  return { valid: true };
}

export function minLength(min: number) {
  return (input: string): ValidationResult => {
    if (input.trim().length < min) {
      return { valid: false, error: `至少需要 ${min} 个字符` };
    }
    return { valid: true };
  };
}

export function maxLength(max: number) {
  return (input: string): ValidationResult => {
    if (input.trim().length > max) {
      return { valid: false, error: `不能超过 ${max} 个字符` };
    }
    return { valid: true };
  };
}

export function isUrl(input: string): ValidationResult {
  try {
    new URL(input);
    return { valid: true };
  } catch {
    return { valid: false, error: '请输入有效的 URL（如 https://example.com）' };
  }
}

export function combine(...validators: Array<(input: string) => ValidationResult>) {
  return (input: string): ValidationResult => {
    for (const validator of validators) {
      const result = validator(input);
      if (!result.valid) return result;
    }
    return { valid: true };
  };
}

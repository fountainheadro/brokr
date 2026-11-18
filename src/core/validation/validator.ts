import { ValidationError } from "../errors/app_error";

export type ValidationRule<T> = (value: T) => string | null;

export class Validator<T extends object> {
  private rules: Map<keyof T, ValidationRule<any>[]> = new Map();

  public addRule<K extends keyof T>(field: K, rule: ValidationRule<T[K]>): this {
    const existing = this.rules.get(field) || [];
    existing.push(rule as ValidationRule<any>);
    this.rules.set(field, existing);
    return this;
  }

  public validate(data: T): { isValid: boolean; errors: Partial<Record<keyof T, string>> } {
    const errors: Partial<Record<keyof T, string>> = {};

    for (const [field, fieldRules] of this.rules.entries()) {
      const value = data[field];
      for (const rule of fieldRules) {
        const error = rule(value);
        if (error) {
          errors[field] = error;
          break;
        }
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    };
  }

  public assertValid(data: T): void {
    const { isValid, errors } = this.validate(data);
    if (!isValid) {
      throw new ValidationError("Validarea datelor a eșuat", errors);
    }
  }
}

// Common Reusable Validation Rules
export const rules = {
  required: (message = "Acest câmp este obligatoriu"): ValidationRule<unknown> => (value) => {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      return message;
    }
    return null;
  },

  email: (message = "Adresă de email invalidă"): ValidationRule<unknown> => (value) => {
    if (!value || typeof value !== "string") return null;
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(value) ? null : message;
  },

  subdomain: (
    message = "Subdomeniul poate conține doar litere mici, cifre și cratime (3-30 caractere)"
  ): ValidationRule<unknown> => (value) => {
    if (!value || typeof value !== "string") return null;
    const regex = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
    return regex.test(value) ? null : message;
  },

  phoneRo: (message = "Număr de telefon invalid"): ValidationRule<unknown> => (value) => {
    if (!value || typeof value !== "string") return null;
    const clean = value.replace(/[\s.-]/g, "");
    return clean.length >= 10 ? null : message;
  },

  minNumber: (min: number, message = `Valoarea minimă este ${min}`): ValidationRule<unknown> => (value) => {
    if (typeof value === "number" && value < min) return message;
    return null;
  },
};

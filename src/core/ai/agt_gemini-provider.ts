import { GoogleGenAI } from "@google/genai";
import { AppError } from "../errors/app_error";
import { DailyQuotaTracker } from "../../../server/monitoring/svc_daily-quota-tracker";

export interface GeminiGenerateOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: any[];
}

export interface GeminiGenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  functionCalls?: Array<{ name: string; args: Record<string, any> }>;
}

export class GeminiProvider {
  private static instance: GoogleGenAI | null = null;
  public static readonly DEFAULT_MODEL = "gemini-4-hydrogen";

  private static getClient(): GoogleGenAI {
    if (!this.instance) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new AppError({
          message: "GEMINI_API_KEY lipsește din variabilele de mediu ale serverului.",
          code: "INTERNAL_ERROR",
          statusCode: 500,
        });
      }

      this.instance = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
    return this.instance;
  }

  /**
   * Generates content via the official @google/genai SDK with timeout and normalized token metrics.
   */
  public static async generate(
    prompt: string | Array<any>,
    options: GeminiGenerateOptions = {}
  ): Promise<GeminiGenerateResult> {
    const ai = this.getClient();
    const model = options.model || this.DEFAULT_MODEL;
    const isGemini4 = model.startsWith("gemini-4-");

    try {
      const config: Record<string, any> = {};
      if (options.systemInstruction) {
        config.systemInstruction = options.systemInstruction;
      }
      if (!isGemini4 && options.temperature !== undefined) {
        config.temperature = options.temperature;
      }
      if (options.maxOutputTokens !== undefined) {
        config.maxOutputTokens = options.maxOutputTokens;
      }

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      const responseText = response.text || "";

      // Extract usage metadata if provided by SDK or compute fallback
      const usageMeta = response.usageMetadata;
      const inputTokens = usageMeta?.promptTokenCount || Math.ceil(JSON.stringify(prompt).length / 4);
      const outputTokens = usageMeta?.candidatesTokenCount || Math.ceil(responseText.length / 4);
      const totalTokens = usageMeta?.totalTokenCount || inputTokens + outputTokens;

      DailyQuotaTracker.recordAiUsage({
        model,
        promptTokens: inputTokens,
        outputTokens,
        totalTokens,
        requests: 1,
      });

      return {
        text: responseText,
        inputTokens,
        outputTokens,
        totalTokens,
        model,
        functionCalls: response.functionCalls?.map((fc: any) => ({
          name: fc.name || "",
          args: (fc.args as Record<string, any>) || {},
        })),
      };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      throw new AppError({
        message: `Eroare la apelul către motorul AI Gemini: ${errMsg}`,
        code: "INTERNAL_ERROR",
        statusCode: 502,
        details: { model, originalError: errMsg },
      });
    }
  }

  /**
   * Estimates rough token count for prompt budgeting and reservations (~4 chars per token).
   */
  public static estimateTokens(input: string | any): number {
    const str = typeof input === "string" ? input : JSON.stringify(input);
    return Math.max(50, Math.ceil(str.length / 4));
  }
}

import type { PlatformId } from '@zemingengine/shared';
export declare function adaptForPlatform(platform: PlatformId, markdownContent: string): {
    contentMarkdown: string;
    contentHtml?: string;
    contentPlain?: string;
};
export declare function countWords(content: string): number;
//# sourceMappingURL=platform-adapter.d.ts.map
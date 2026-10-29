/**
 * Article content utilities: append contact info footer, etc.
 */

import type { Article, EnterpriseProfile } from '@zemingengine/shared';

/**
 * EK 信源为空的兜底声明：提示词约束模型未必遵守，代码层强制补一行，
 * 保证「无企业专属信源」对读者可见。
 */
export const EK_EMPTY_DISCLAIMER = '本文基于行业公开观点整理，不含企业专属信源';

export function appendEkDisclaimer(article: Article): Article {
  if (article.contentMarkdown.includes(EK_EMPTY_DISCLAIMER)) return article;
  const newContentMd = article.contentMarkdown.trimEnd() + `\n\n> ${EK_EMPTY_DISCLAIMER}。\n`;

  let newContentHtml = article.contentHtml;
  if (newContentHtml) {
    newContentHtml += `\n<blockquote><p>${EK_EMPTY_DISCLAIMER}。</p></blockquote>`;
  }

  const wordCount = newContentMd.replace(/[#*`>\-\[\]()!]/g, '').length;
  return { ...article, contentMarkdown: newContentMd, contentHtml: newContentHtml, wordCount };
}

/**
 * Append enterprise contact information to the end of an article.
 * Only appends if the enterprise has at least one contact field (phone/email/address)
 * and the article doesn't already seem to have contact info at the end.
 *
 * The footer is appended as a Markdown section with a horizontal rule separator,
 * so it renders consistently across platforms (Markdown → HTML adapters handle it).
 */
export function appendContactFooter(
  article: Article,
  enterprise: EnterpriseProfile | undefined,
): Article {
  if (!enterprise) return article;

  const { phone, email, address, fullName, shortName } = enterprise;
  const hasContact = (phone?.trim() || email?.trim() || address?.trim());
  if (!hasContact) return article;

  const brandName = shortName || fullName || '我们';

  // Check if article already has contact info near the end (avoid double-appending)
  const content = article.contentMarkdown || '';
  const tail = content.slice(-500); // check last 500 chars
  const alreadyHasContact = /(电话|联系|咨询电话|联系方式|contact)/i.test(tail)
    && (phone ? tail.includes(phone.trim()) : false
      || email ? tail.includes(email.trim()) : false);

  if (alreadyHasContact) return article;

  // Build the footer in Markdown
  const lines: string[] = [];
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`**联系${brandName}**`);
  lines.push('');

  if (phone?.trim()) {
    lines.push(`- 📞 电话：${phone.trim()}`);
  }
  if (email?.trim()) {
    lines.push(`- 📧 邮箱：${email.trim()}`);
  }
  if (address?.trim()) {
    lines.push(`- 📍 地址：${address.trim()}`);
  }

  lines.push('');

  const footerMd = lines.join('\n');
  const newContentMd = content + footerMd;

  // Also update HTML content if present (simple conversion)
  let newContentHtml = article.contentHtml;
  if (newContentHtml) {
    const htmlLines: string[] = [];
    htmlLines.push('<hr />');
    htmlLines.push(`<p><strong>联系${brandName}</strong></p>`);
    htmlLines.push('<ul>');
    if (phone?.trim()) {
      htmlLines.push(`<li>📞 电话：${phone.trim()}</li>`);
    }
    if (email?.trim()) {
      htmlLines.push(`<li>📧 邮箱：${email.trim()}</li>`);
    }
    if (address?.trim()) {
      htmlLines.push(`<li>📍 地址：${address.trim()}</li>`);
    }
    htmlLines.push('</ul>');
    newContentHtml = newContentHtml + '\n' + htmlLines.join('\n');
  }

  // Recalculate word count (approximate)
  const wordCount = newContentMd.replace(/[#*`>\-\[\]()!]/g, '').length;

  return {
    ...article,
    contentMarkdown: newContentMd,
    contentHtml: newContentHtml,
    wordCount,
  };
}

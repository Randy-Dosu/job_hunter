/**
 * We Work Remotely — public RSS feed.
 *
 * Access: documented public RSS (https://weworkremotely.com/categories/*.rss).
 * No authentication. We read the feed, keep the posting link and attribution.
 */

import type {
  JobConnector,
  ConnectorContext,
  ConnectorPageResult,
  ConnectorSearchQuery,
} from './types.js';
import { fetchText } from './http.js';
import {
  cleanText,
  decodeEntities,
  htmlToText,
  inferSeniority,
  normalizeEmploymentType,
  resolveCountryCode,
  safeUrl,
  truncateDescription,
} from './normalize.js';
import { matchesQuery } from './remoteok.js';

export const WEWORKREMOTELY_FEEDS: Record<string, string> = {
  programming: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  design: 'https://weworkremotely.com/categories/remote-design-jobs.rss',
  'customer-support': 'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
  product: 'https://weworkremotely.com/categories/remote-product-jobs.rss',
  marketing: 'https://weworkremotely.com/categories/remote-marketing-jobs.rss',
  sales: 'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss',
  'all-other': 'https://weworkremotely.com/categories/all-other-remote-jobs.rss',
};

interface RssItem {
  title: string;
  region: string;
  company: string;
  description: string;
  link: string;
  pubDate?: string | undefined;
  guid?: string | undefined;
}

/** Minimal, dependency-free RSS parser sufficient for well-formed feeds. */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const rawTitle = tagValue(block, 'title');
    const link = tagValue(block, 'link') || tagValue(block, 'guid');
    const description = tagValue(block, 'description');
    const region = tagValue(block, 'region');
    const pubDate = tagValue(block, 'pubDate');
    const guid = tagValue(block, 'guid');
    if (!rawTitle || !link) continue;

    // WWR titles are "Company: Job Title".
    const decodedTitle = decodeEntities(stripCdata(rawTitle)).trim();
    const separator = decodedTitle.indexOf(':');
    const company = separator > 0 ? decodedTitle.slice(0, separator).trim() : '';
    const title = separator > 0 ? decodedTitle.slice(separator + 1).trim() : decodedTitle;

    items.push({
      title: cleanText(title).slice(0, 200),
      company: cleanText(company).slice(0, 160),
      region: cleanText(decodeEntities(stripCdata(region))).slice(0, 160),
      description: htmlToText(stripCdata(description)),
      link: decodeEntities(stripCdata(link)).trim(),
      pubDate: pubDate ? decodeEntities(stripCdata(pubDate)).trim() : undefined,
      guid: guid ? decodeEntities(stripCdata(guid)).trim() : undefined,
    });
  }
  return items;
}

function tagValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** Pick the feeds that best match the user's target titles. */
export function selectFeeds(titles: string[], keywords: string[]): string[] {
  const text = [...titles, ...keywords].join(' ').toLowerCase();
  const selected = new Set<string>();
  if (
    /engineer|developer|software|devops|data|programmer|full[- ]?stack|frontend|backend|qa|security/i.test(
      text,
    )
  ) {
    selected.add(WEWORKREMOTELY_FEEDS.programming as string);
  }
  if (/design|ux|ui/i.test(text)) selected.add(WEWORKREMOTELY_FEEDS.design as string);
  if (/product manager|product owner|product/i.test(text))
    selected.add(WEWORKREMOTELY_FEEDS.product as string);
  if (/market|seo|content|growth/i.test(text))
    selected.add(WEWORKREMOTELY_FEEDS.marketing as string);
  if (/sales|account executive|business development/i.test(text))
    selected.add(WEWORKREMOTELY_FEEDS.sales as string);
  if (/support|success/i.test(text))
    selected.add(WEWORKREMOTELY_FEEDS['customer-support'] as string);
  if (selected.size === 0) selected.add(WEWORKREMOTELY_FEEDS.programming as string);
  const feeds = [...selected];
  return feeds.slice(0, 2);
}

export const weWorkRemotelyConnector: JobConnector = {
  id: 'weworkremotely',
  name: 'We Work Remotely',
  family: 'board',
  accessMethod: 'public_api',
  docsUrl: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  notes:
    'Public RSS category feeds. We read at most two category feeds per scan and always link to the original posting.',
  supports: {
    keywordSearch: false,
    locationSearch: false,
    remoteOnly: true,
    pagination: false,
    postedSince: false,
  },

  isConfigured() {
    return true;
  },

  buildQuery(prefs, limit): ConnectorSearchQuery {
    return {
      titles: prefs.targetTitles,
      keywords: prefs.targetKeywords,
      locations: prefs.locations,
      countryCodes: prefs.countryCodes,
      remoteOnly: true,
      limit,
    };
  },

  async fetchPage(
    query: ConnectorSearchQuery,
    context: ConnectorContext,
  ): Promise<ConnectorPageResult> {
    const feeds = selectFeeds(query.titles, query.keywords);
    const errors: string[] = [];
    const jobs: ConnectorPageResult['jobs'] = [];
    const seen = new Set<string>();

    for (const feed of feeds) {
      try {
        const xml = await fetchText(feed, context, { timeoutMs: 12_000 });
        for (const item of parseRssItems(xml)) {
          const url = safeUrl(item.link, 'weworkremotely.com');
          if (!url || seen.has(url)) continue;
          if (!matchesQuery(item.title, [], query)) continue;
          seen.add(url);
          const locationRaw = item.region || 'Remote';
          const postedAt = item.pubDate ? safeDate(item.pubDate) : undefined;
          jobs.push({
            title: item.title,
            company: item.company || 'Unknown company',
            description: truncateDescription(item.description),
            url,
            externalId: item.guid || url,
            locationRaw,
            remote: true,
            employmentTypeHint: normalizeEmploymentType(item.title, item.description.slice(0, 400)),
            seniorityHint: inferSeniority(item.title),
            ...(postedAt ? { postedAt } : {}),
            tags: [],
            countryHint: resolveCountryCode({ locationRaw }),
          });
          if (jobs.length >= query.limit) break;
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'unknown feed error');
      }
      if (jobs.length >= query.limit) break;
    }

    if (jobs.length === 0 && errors.length === feeds.length) {
      throw new Error(`All We Work Remotely feeds failed: ${errors.join('; ')}`);
    }

    return {
      jobs,
      ...(errors.length > 0
        ? { note: `Partial feed read: ${errors.length}/${feeds.length} failed` }
        : {}),
    };
  },
};

function safeDate(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

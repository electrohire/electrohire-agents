// WS-5 tests (2026-10-26, NOT frozen): the public blog/events mirror
// loader and the scope wiring for the new surfaces. Run from repo root:
//   node --test tests/ws5-public-content.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBlogPosts, loadBlogPost, loadEvents, resetPublicContentCache } from '../packages/platform/src/publiccontent.ts';
import { scopeForApiPath, scopeForMcpTool, SCOPE_CATALOG } from '../packages/platform/src/apikeys.ts';
import { OAUTH_OFFERED_SCOPES } from '../packages/platform/src/oauth.ts';

const BLOG = JSON.stringify({ total: 1, posts: [{ slug: 'a-post', title: 'A Post', metaDescription: 'x', authorName: 'Test', publishedAt: 1, readMinutes: 2, categories: [], kind: 'article', url: 'https://beta.electrohire.com/blog/a-post', body: 'full text' }] });
const EVENTS = JSON.stringify({ total: 1, events: [{ slug: 'an-event', title: 'An Event', description: 'x', date: '2026-11-01', timeLabel: '', venue: '', tag: '', url: 'https://beta.electrohire.com/events/an-event' }] });

test('WS5: blog + events load from the local stand-ins', async () => {
  resetPublicContentCache();
  const blog = await loadBlogPosts({ BLOG_JSON: BLOG });
  assert.equal(blog.total, 1);
  const post = await loadBlogPost({ BLOG_JSON: BLOG }, 'a-post');
  assert.equal(post.body, 'full text');
  assert.equal(await loadBlogPost({ BLOG_JSON: BLOG }, 'a-draft'), null);
  const events = await loadEvents({ EVENTS_JSON: EVENTS });
  assert.equal(events.events[0].slug, 'an-event');
});

test('WS5: the new routes and tools carry the new scopes', () => {
  assert.equal(scopeForApiPath('/v1/blog'), 'read:blog');
  assert.equal(scopeForApiPath('/v1/blog/a-post'), 'read:blog');
  assert.equal(scopeForApiPath('/v1/events'), 'read:events');
  assert.equal(scopeForMcpTool('electrohire_list_blog_posts'), 'read:blog');
  assert.equal(scopeForMcpTool('electrohire_get_blog_post'), 'read:blog');
  assert.equal(scopeForMcpTool('electrohire_list_events'), 'read:events');
});

test('WS5: scope catalog and OAuth offered scopes agree, including read:events', () => {
  const catalog = SCOPE_CATALOG.map((s) => s.id).sort();
  assert.deepEqual(catalog, [...OAUTH_OFFERED_SCOPES].sort());
  assert.ok(catalog.includes('read:events'));
});

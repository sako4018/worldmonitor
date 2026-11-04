import { h } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import { HIDE_PREMIUM } from '@/config/fork';
import { BRIEF_TOPICS, BRIEF_SECTIONS, type BriefTopic, type BriefSectionState, type BriefSectionId } from '../../shared/country-brief-sections';
export { BRIEF_TOPICS, BRIEF_SECTIONS, type BriefTopic, type BriefSectionState, type BriefSectionId } from '../../shared/country-brief-sections';

export interface BriefSection {
  id: BriefSectionId;
  title: string;
  card: HTMLElement;
  body: HTMLElement;
}

export function briefSectionState(section: BriefSection): BriefSectionState {
  if (section.body.querySelector('.cdp-pro-locked, [data-brief-state="locked"]')) return 'locked';
  if (section.body.querySelector('.cdp-loading-inline')) return 'loading';
  if (section.body.firstElementChild?.classList.contains('cdp-empty')
    || section.body.querySelector('[data-brief-state="unavailable"]')) return 'unavailable';
  return 'ready';
}

export function summarizeCountryBrief(brief: string): string {
  const paragraphs = brief.replace(/\r/g, '').split(/\n\s*\n/)
    .map(paragraph => paragraph.split('\n').filter(line => {
      const text = line.trim();
      return text && !/^#{1,6}\s/.test(text) && !/^\*\*[^*]+\*\*:?$/.test(text)
        && !/^(?:Date|Classification):/i.test(text) && !/^[A-Z][A-Z\s:–-]+$/.test(text);
    }).join(' ').trim()).filter(Boolean);
  const lead = paragraphs.find(paragraph => paragraph.replace(/[*#]/g, '').length > 100) ?? paragraphs[0] ?? '';
  const sentences = lead.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [lead];
  let summary = '';
  for (const sentence of sentences.slice(0, 3)) {
    if (summary && summary.length + sentence.length > 700) break;
    summary += sentence;
  }
  return summary.trim();
}

export class CountryBriefPresentation {
  private topic: BriefTopic = 'overview';
  private mode: 'summary' | 'full' = 'full';
  private observer: MutationObserver | null = null;
  private readonly status = h('span', { role: 'status', 'aria-live': 'polite' });
  private readonly nav = h('nav', { className: 'cdp-topic-nav', 'aria-label': t('cbf.nav.topicsAria', { defaultValue: 'Country topics' }) });
  private readonly index = h('nav', { className: 'cdp-section-index', 'aria-label': t('cbf.nav.sectionsAria', { defaultValue: 'Sections in this topic' }) });
  private readonly modeButtons = h('div', { className: 'cdp-reading-modes', 'aria-label': t('cbf.nav.modeAria', { defaultValue: 'Brief reading mode' }) });
  private readonly explore = h('div', { className: 'cdp-explore' });

  constructor(private readonly shell: HTMLElement, readonly sections: BriefSection[]) {
    for (const mode of ['summary', 'full'] as const) {
      const button = h('button', { type: 'button', 'data-mode': mode }, mode === 'summary' ? t('cbf.nav.summary', { defaultValue: 'Summary' }) : t('cbf.nav.full', { defaultValue: 'Full brief' }));
      button.addEventListener('click', () => {
        this.mode = mode;
        this.topic = mode === 'summary' ? 'overview' : 'all';
        this.applyView();
      });
      this.modeButtons.append(button);
    }
    for (const [topic, label] of Object.entries(BRIEF_TOPICS)) {
      const topicLabel = t(`cbf.topic.${topic}`, { defaultValue: label });
      const button = h('button', { type: 'button', 'data-topic': topic }, topicLabel);
      button.addEventListener('click', () => this.selectTopic(topic as BriefTopic));
      this.nav.append(button);
      if (topic !== 'overview' && topic !== 'all' && topic !== 'sources') {
        const tile = h('button', { type: 'button' }, h('strong', {}, topicLabel), h('span', {}, t('cbf.nav.explore', { defaultValue: 'Explore this topic ↗' })));
        tile.addEventListener('click', () => this.selectTopic(topic as BriefTopic));
        this.explore.append(tile);
      }
    }
    const lead = shell.querySelector('.cdp-overview-lead')!;
    shell.insertBefore(h('div', { className: 'cdp-reading-controls' }, this.modeButtons), lead);
    shell.insertBefore(this.nav, lead);
    shell.insertBefore(h('div', { className: 'cdp-load-status' }, this.status,
      h('span', {}, t('cbf.nav.sourcesNote', { defaultValue: 'Sources update independently. Observation dates stay with each measure.' }))), lead);
    const grid = shell.querySelector<HTMLElement>('.cdp-grid')!;
    const reading = h('div', { className: 'cdp-reading-grid' });
    shell.insertBefore(reading, grid);
    reading.append(this.index, grid);
    shell.append(this.explore);
    for (const section of sections) {
      const link = h('button', { type: 'button', 'data-section-link': section.id }, section.title);
      link.addEventListener('click', () => {
        section.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        section.card.focus({ preventScroll: true });
      });
      this.index.append(link);
    }
    this.applyView();
    this.refreshStatus();
    // The existing renderers, including lazy widgets, own their load/empty markup.
    // Observe only content changes so status never replaces a user's active section.
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => this.refreshStatus());
      for (const section of sections) this.observer.observe(section.body, { childList: true, subtree: true });
    }
  }

  selectTopic(topic: BriefTopic): void {
    this.topic = topic;
    this.mode = 'full';
    this.applyView();
  }

  private applyView(): void {
    this.shell.dataset.briefMode = this.mode;
    this.shell.dataset.briefTopic = this.topic;
    for (const button of this.modeButtons.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === this.mode));
    }
    for (const button of this.nav.querySelectorAll('button')) {
      button.setAttribute('aria-current', button.dataset.topic === this.topic ? 'page' : 'false');
    }
    for (const section of this.sections) {
      const topics: readonly BriefTopic[] = BRIEF_SECTIONS[section.id];
      // Fork: Pro-locked sections are not shown at all.
      section.card.hidden = (this.topic !== 'all' && !topics.includes(this.topic)) || (HIDE_PREMIUM && briefSectionState(section) === 'locked');
      this.index.querySelector<HTMLElement>(`[data-section-link="${section.id}"]`)!.hidden = section.card.hidden;
    }
    this.index.hidden = this.topic === 'overview';
    this.explore.hidden = this.topic !== 'overview';
  }

  private refreshStatus(): void {
    const counts = { ready: 0, loading: 0, unavailable: 0, locked: 0 };
    for (const section of this.sections) {
      const state = briefSectionState(section);
      counts[state]++;
      section.card.dataset.loadState = state;
      section.card.setAttribute('aria-busy', String(state === 'loading'));
    }
    const text = [t('cbf.status.ready', { defaultValue: '{{count}} sections ready', count: counts.ready }),
      counts.loading ? t('cbf.status.loading', { defaultValue: '{{count}} loading', count: counts.loading }) : '',
      counts.unavailable ? t('cbf.status.unavailable', { defaultValue: '{{count}} unavailable', count: counts.unavailable }) : '',
      counts.locked && !HIDE_PREMIUM ? t('cbf.status.pro', { defaultValue: '{{count}} Pro', count: counts.locked }) : ''].filter(Boolean).join(' · ');
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  destroy(): void {
    this.observer?.disconnect();
  }
}

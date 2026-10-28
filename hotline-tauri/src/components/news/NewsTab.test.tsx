import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import NewsTab from './NewsTab';
import { formatHotlineDate } from '../../utils/formatHotlineDate';

it('formats both article list and detail timestamps using the system locale', () => {
  const article = { id: 1, parent_id: 0, flags: 0, title: 'News', poster: 'Author', date: '2026-07-15T13:30:00Z', path: [] };
  const props: ComponentProps<typeof NewsTab> = {
    newsPath: [], newsCategories: [], newsArticles: [article], selectedArticle: article,
    articleContent: 'Body', loadingNews: false, showComposer: false,
    composerTitle: '', composerBody: '', postingNews: false,
    onNewsPathChange: vi.fn(), onNewsBack: vi.fn(), onNavigateNews: vi.fn(),
    onSelectArticle: vi.fn(), onToggleComposer: vi.fn(), onComposerTitleChange: vi.fn(),
    onComposerBodyChange: vi.fn(), onPostNews: vi.fn(),
  };
  render(<NewsTab {...props} />);
  expect(screen.getAllByText(`• ${formatHotlineDate(article.date)}`)).toHaveLength(2);
  expect(screen.queryByText(article.date)).not.toBeInTheDocument();
});

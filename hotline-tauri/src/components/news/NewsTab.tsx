import { useState } from 'react';
import MarkdownText from '../common/MarkdownText';
import { formatHotlineDate } from '../../utils/formatHotlineDate';

interface NewsCategory {
  type: number;
  count: number;
  name: string;
  path: string[];
}

interface NewsArticle {
  id: number;
  parent_id: number;
  flags: number;
  title: string;
  poster: string;
  date?: string;
  path: string[];
}

interface NewsTabProps {
  newsPath: string[];
  newsCategories: NewsCategory[];
  newsArticles: NewsArticle[];
  selectedArticle: NewsArticle | null;
  articleContent: string;
  loadingNews: boolean;
  showComposer: boolean;
  composerTitle: string;
  composerBody: string;
  postingNews: boolean;
  canCreateCategory?: boolean;
  canDeleteCategory?: boolean;
  canCreateFolder?: boolean;
  canDeleteFolder?: boolean;
  canDeleteArticle?: boolean;
  onNewsPathChange: (path: string[]) => void;
  onNewsBack: () => void;
  onNavigateNews: (category: NewsCategory) => void;
  onSelectArticle: (article: NewsArticle) => void;
  onClearSelectedArticle?: () => void;
  onToggleComposer: () => void;
  onComposerTitleChange: (value: string) => void;
  onComposerBodyChange: (value: string) => void;
  onPostNews: (e: React.FormEvent) => void;
  onCreateCategory?: (name: string) => Promise<void>;
  onCreateFolder?: (name: string) => Promise<void>;
  onDeleteItem?: (path: string[]) => Promise<void>;
  onDeleteArticle?: (articleId: number, path: string[]) => Promise<void>;
}

export default function NewsTab({
  newsPath,
  newsCategories,
  newsArticles,
  selectedArticle,
  articleContent,
  loadingNews,
  showComposer,
  composerTitle,
  composerBody,
  postingNews,
  canCreateCategory = false,
  canDeleteCategory = false,
  canCreateFolder = false,
  canDeleteFolder = false,
  canDeleteArticle = false,
  onNewsPathChange,
  onNewsBack,
  onNavigateNews,
  onSelectArticle,
  onClearSelectedArticle,
  onToggleComposer,
  onComposerTitleChange,
  onComposerBodyChange,
  onPostNews,
  onCreateCategory,
  onCreateFolder,
  onDeleteItem,
  onDeleteArticle,
}: NewsTabProps) {
  // On mobile, show article detail view if an article is selected or composer is open
  const showMobileDetail = selectedArticle || showComposer;

  const [newItemMode, setNewItemMode] = useState<'category' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');

  return (
    <div className="flex-1 flex md:flex-row flex-col h-full overflow-hidden">
      {/* Left panel: Categories and Articles — hidden on mobile when viewing article */}
      <div className={`md:w-1/2 md:border-r border-gray-200 dark:border-gray-700 flex flex-col h-full overflow-hidden ${showMobileDetail ? 'hidden md:flex' : 'flex'}`}>
        {/* Path breadcrumb */}
        <div className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center gap-2">
          <button
            onClick={() => onNewsPathChange([])}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            News
          </button>
          {newsPath.map((segment, index) => {
            // Create unique key from path segment and position
            const uniqueKey = `news-path-${index}-${segment}`;
            return (
            <span key={uniqueKey} className="flex items-center gap-2">
              <span className="text-gray-400 dark:text-gray-500">/</span>
              <button
                onClick={() => onNewsPathChange(newsPath.slice(0, index + 1))}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                {segment}
              </button>
            </span>
            );
          })}
          {newsPath.length > 0 && (
            <button
              onClick={onNewsBack}
              className="ml-auto text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              ← Back
            </button>
          )}
        </div>

        {/* Categories list */}
        {newsCategories.length > 0 && (
          <div className="border-b border-gray-200 dark:border-gray-700">
            <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-400 flex items-center justify-between">
              <span>CATEGORIES</span>
              <div className="flex gap-1">
                {canCreateCategory && onCreateCategory && (
                  <button onClick={() => { setNewItemMode('category'); setNewItemName(''); }} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ Category</button>
                )}
                {canCreateFolder && onCreateFolder && (
                  <button onClick={() => { setNewItemMode('folder'); setNewItemName(''); }} className="text-xs text-blue-600 dark:text-blue-400 hover:underline ml-2">+ Folder</button>
                )}
              </div>
            </div>
            {/* Inline new item input */}
            {newItemMode && (
              <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 flex gap-2">
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder={`${newItemMode === 'category' ? 'Category' : 'Folder'} name...`}
                  autoFocus
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newItemName.trim()) {
                      if (newItemMode === 'category') await onCreateCategory!(newItemName.trim());
                      else await onCreateFolder!(newItemName.trim());
                      setNewItemMode(null);
                      setNewItemName('');
                    }
                    if (e.key === 'Escape') { setNewItemMode(null); setNewItemName(''); }
                  }}
                  className="flex-1 px-2 py-1 text-sm border border-blue-300 dark:border-blue-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={async () => {
                    if (newItemName.trim()) {
                      if (newItemMode === 'category') await onCreateCategory!(newItemName.trim());
                      else await onCreateFolder!(newItemName.trim());
                    }
                    setNewItemMode(null);
                    setNewItemName('');
                  }}
                  disabled={!newItemName.trim()}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded"
                >Create</button>
                <button onClick={() => { setNewItemMode(null); setNewItemName(''); }} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            )}
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {newsCategories.map((category, index) => {
                // Create unique key from category path and name
                const uniqueKey = `category-${category.path.join('/')}-${category.name}-${index}`;
                const canDelete = (canDeleteCategory || canDeleteFolder) && onDeleteItem;
                return (
                <div key={uniqueKey} className="flex items-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group">
                  <button
                    onClick={() => onNavigateNews(category)}
                    className="flex-1 px-4 py-2 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        📁 {category.name}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {category.count} {category.count === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                  </button>
                  {canDelete && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${category.name}"? This cannot be undone.`)) {
                          await onDeleteItem!(category.path);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 px-2 py-1 mr-2 text-red-500 hover:text-red-700 transition-opacity"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Articles list */}
        <div className="flex-1 overflow-y-auto">
          {loadingNews ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
              Loading news...
            </div>
          ) : newsCategories.length === 0 && newsArticles.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8 px-4">
              <p className="mb-2">No news available</p>
              <p className="text-xs">This server may not support news, or there are no news articles.</p>
              {(canCreateCategory || canCreateFolder) && !newItemMode && (
                <div className="flex gap-2 justify-center mt-4">
                  {canCreateCategory && onCreateCategory && (
                    <button onClick={() => { setNewItemMode('category'); setNewItemName(''); }} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded">+ Category</button>
                  )}
                  {canCreateFolder && onCreateFolder && (
                    <button onClick={() => { setNewItemMode('folder'); setNewItemName(''); }} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded">+ Folder</button>
                  )}
                </div>
              )}
            </div>
          ) : newsArticles.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
              No articles in this category
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {(() => {
                // Build depth map for indentation
                const depthMap = new Map<number, number>();
                for (const article of newsArticles) {
                  if (article.parent_id === 0) {
                    depthMap.set(article.id, 0);
                  } else {
                    const parentDepth = depthMap.get(article.parent_id) ?? 0;
                    depthMap.set(article.id, parentDepth + 1);
                  }
                }
                return newsArticles.map((article) => {
                  const depth = depthMap.get(article.id) ?? 0;
                  return (
                <div key={article.id} className="flex items-center group hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <button
                    onClick={() => onSelectArticle(article)}
                    className={`flex-1 py-3 pr-4 text-left ${
                      selectedArticle?.id === article.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                    style={{ paddingLeft: `${1 + depth * 1.25}rem` }}
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {depth > 0 && <span className="text-gray-400 dark:text-gray-500 mr-1">↳</span>}
                      {article.title}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      by {article.poster}
                      {article.date && (
                        <span className="ml-2 text-gray-500 dark:text-gray-500">
                          • {formatHotlineDate(article.date)}
                        </span>
                      )}
                    </div>
                  </button>
                  {canDeleteArticle && onDeleteArticle && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(`Delete article "${article.title}"? This cannot be undone.`)) {
                          await onDeleteArticle(article.id, article.path);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 px-2 py-1 mr-2 text-red-500 hover:text-red-700 transition-opacity"
                      title="Delete article"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

        {/* Post button */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <button
            onClick={onToggleComposer}
            className={`w-full px-4 py-2 text-white rounded-md font-medium ${
              showComposer
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {showComposer ? 'Cancel' : selectedArticle ? 'Reply to Article' : 'Post Article'}
          </button>
        </div>
      </div>

      {/* Right panel: Article viewer or composer — full width on mobile */}
      <div className={`md:w-1/2 flex flex-col h-full overflow-hidden ${showMobileDetail ? 'flex' : 'hidden md:flex'}`}>
        {showComposer ? (
          /* Composer */
          <form onSubmit={onPostNews} className="flex-1 flex flex-col p-4 min-h-0">
            <div className="flex items-center gap-2 mb-4 flex-shrink-0">
              <button
                type="button"
                onClick={() => { onToggleComposer(); }}
                className="md:hidden text-sm text-blue-600 dark:text-blue-400"
              >
                ← Back
              </button>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {selectedArticle ? `Reply to: ${selectedArticle.title}` : 'Post New Article'}
              </h3>
            </div>
            <input
              type="text"
              value={composerTitle}
              onChange={(e) => onComposerTitleChange(e.target.value)}
              placeholder="Article title..."
              className="flex-shrink-0 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <textarea
              value={composerBody}
              onChange={(e) => onComposerBodyChange(e.target.value)}
              placeholder="Article content..."
              className="flex-1 min-h-[120px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-4"
            />
            <button
              type="submit"
              disabled={!composerTitle.trim() || !composerBody.trim() || postingNews}
              className="flex-shrink-0 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md font-medium disabled:cursor-not-allowed"
            >
              {postingNews ? 'Posting...' : 'Post'}
            </button>
          </form>
        ) : selectedArticle ? (
          /* Article viewer */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800">
              {onClearSelectedArticle && (
                <button
                  onClick={onClearSelectedArticle}
                  className="md:hidden text-sm text-blue-600 dark:text-blue-400 mb-2"
                >
                  ← Back to articles
                </button>
              )}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {selectedArticle.title}
                  </h2>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    by {selectedArticle.poster}
                    {selectedArticle.date && (
                      <span className="ml-2 text-gray-500 dark:text-gray-500">
                        • {formatHotlineDate(selectedArticle.date)}
                      </span>
                    )}
                  </div>
                </div>
                {canDeleteArticle && onDeleteArticle && (
                  <button
                    onClick={async () => {
                      if (confirm(`Delete article "${selectedArticle.title}"? This cannot be undone.`)) {
                        await onDeleteArticle(selectedArticle.id, selectedArticle.path);
                      }
                    }}
                    className="flex-shrink-0 p-1 text-red-500 hover:text-red-700"
                    title="Delete article"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                <MarkdownText text={articleContent} />
              </div>
            </div>
          </div>
        ) : (
          /* No article selected */
          <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
            Select an article to read
          </div>
        )}
      </div>
    </div>
  );
}

import { Copy } from 'lucide-react';
import { Children, isValidElement, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { Button } from './Button';
import { useTheme } from '../hooks/useTheme';

function stringifyChildren(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyChildren(item)).join('');
  }
  if (value && typeof value === 'object' && 'props' in value) {
    const record = value as { props?: { children?: unknown } };
    return stringifyChildren(record.props?.children);
  }
  return '';
}

interface PrettyMarkdownProps {
  value: string;
  className?: string;
}

/** Renders Markdown with syntax-highlighted, copyable fenced code blocks. */
export function PrettyMarkdown({ value, className = '' }: PrettyMarkdownProps) {
  const { t } = useTranslation();
  const { preference } = useTheme();
  const prismStyle = preference === 'dark' ? oneDark : oneLight;
  const themeStyle: Record<string, CSSProperties> = prismStyle;

  return (
    <div className={`prose prose-slate max-w-none text-sm ${className}`}>
      <ReactMarkdown
        components={{
          // react-markdown (v9+) no longer tells `code` whether it is inline, and treating every
          // `code` as a block turned each inline `token` into its own "Copy code" box (the
          // Phase 13-15 per-token bug). Only a fenced block is wrapped in `pre`, so the block
          // rendering lives here and `code` below is always inline.
          pre({ children }) {
            const [codeElement] = Children.toArray(children);
            const classNameProp = isValidElement<{ className?: string }>(codeElement)
              ? codeElement.props.className
              : undefined;
            const codeText = stringifyChildren(children).replace(/\n$/, '');
            const language = classNameProp ? classNameProp.replace('language-', '') : 'text';

            return (
              <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface-muted">
                <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                  <span>{language}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(codeText);
                    }}
                    ariaLabel={t('workspace.copyCode')}
                  >
                    <Copy className="size-3.5" />
                    {t('workspace.copyCode')}
                  </Button>
                </div>
                <SyntaxHighlighter
                  language={language}
                  style={themeStyle}
                  customStyle={{
                    margin: 0,
                    background: 'transparent',
                    padding: '1rem',
                    fontSize: '0.82rem',
                  }}
                  showLineNumbers
                  wrapLongLines
                >
                  {codeText}
                </SyntaxHighlighter>
              </div>
            );
          },
          code({ children }) {
            return (
              <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[0.82em] text-primary">
                {stringifyChildren(children)}
              </code>
            );
          },
          p({ children }) {
            return <p className="mb-4 leading-7 text-fg">{children}</p>;
          },
          ul({ children }) {
            return <ul className="mb-4 list-disc space-y-2 pl-6 text-fg">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="mb-4 list-decimal space-y-2 pl-6 text-fg">{children}</ol>;
          },
          h1({ children }) {
            return <h1 className="mb-4 text-2xl font-semibold text-fg">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="mb-3 text-xl font-semibold text-fg">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="mb-2 text-lg font-semibold text-fg">{children}</h3>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="mb-4 border-l-2 border-primary/60 bg-primary-soft px-3 py-2 text-fg-muted">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

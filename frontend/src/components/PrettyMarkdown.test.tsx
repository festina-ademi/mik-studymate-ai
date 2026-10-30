import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PrettyMarkdown } from './PrettyMarkdown';

describe('PrettyMarkdown', () => {
  it('gives only fenced blocks a copy button; inline `token` stays inline code', () => {
    const { container } = render(
      <PrettyMarkdown
        value={
          '```python\ndef check(password):\n```\n\n' +
          '`def` - Keyword that declares a function.\n\n' +
          '`check` - The function name.'
        }
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Copy code' })).toHaveLength(1);
    expect(container.querySelectorAll('pre')).toHaveLength(1);
    const inline = [...container.querySelectorAll('p > code')].map((node) => node.textContent);
    expect(inline).toEqual(['def', 'check']);
    expect(screen.getByText(/Keyword that declares a function/)).toBeInTheDocument();
  });

  it('labels a fenced block with its language, falling back to "text"', () => {
    render(<PrettyMarkdown value={'```javascript\nlet a = 1;\n```\n\n```\nplain\n```'} />);

    expect(screen.getByText('javascript')).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy code' })).toHaveLength(2);
  });
});

// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';

describe('React rendering smoke test', () => {
  test('React rendering works in jsdom test environment', () => {
    render(<div data-testid="hello">Hello Ariadline</div>);
    expect(screen.getByTestId('hello')).toBeInTheDocument();
    expect(screen.getByTestId('hello')).toHaveTextContent('Hello Ariadline');
  });
});

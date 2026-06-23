import { render } from '@solidjs/testing-library';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App Component', () => {
  it('renders welcome message', () => {
    const { getByText } = render(() => <App />);
    expect(getByText('Welcome to Collections')).toBeDefined();
  });
});

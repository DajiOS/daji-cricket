import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Intro } from './Intro';

createRoot(document.getElementById('root')!).render(<><App /><Intro /></>);

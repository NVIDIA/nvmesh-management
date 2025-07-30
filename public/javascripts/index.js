/* global ReactDOM, React */

import AppShell from './components_js/shared/AppShell.js';
import App from './components_js/pages/App.js';

const reactAppElement = document.getElementById('root');
const root = ReactDOM.createRoot(reactAppElement);
root.render(React.createElement(App, null, React.createElement(AppShell, null)));
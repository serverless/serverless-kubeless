import { createStore, applyMiddleware, compose } from 'redux';
import thunk from 'redux-thunk';
import createLogger from 'redux-logger';

import reducers from './reducers';

const devTools = window.devToolsExtension ? window.devToolsExtension() : f => f;

const createStoreWithMiddleware = compose(
  applyMiddleware(thunk, createLogger()),
  devTools
)(createStore);

export default createStoreWithMiddleware(reducers);

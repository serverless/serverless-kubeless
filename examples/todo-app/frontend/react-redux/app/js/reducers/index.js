import { combineReducers } from 'redux';

import TodosReducer from './todos';
import ErrorReducer from './error';

export default combineReducers({
  todos: TodosReducer,
  error: ErrorReducer
});

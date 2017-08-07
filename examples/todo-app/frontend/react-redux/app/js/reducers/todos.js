import _ from 'lodash';

import {
  CREATE_TODO,
  GET_TODOS,
  GET_TODO,
  UPDATE_TODO,
  DELETE_TODO
} from '../actions/constants';

const INITIAL_STATE = { todos: [], todo: null };

export default function(state = INITIAL_STATE, action) {
  let todos;

  switch(action.type) {
    case CREATE_TODO:
      todos = state.todos.slice();
      todos.unshift(action.payload);
      return { ...state, todos: todos };
    case GET_TODOS:
      return { ...state, todos: action.payload };
    case GET_TODO:
      return { ...state, todo: action.payload };
    case UPDATE_TODO:
      todos = _.without(state.todos,
        _.find(state.todos, { id: action.previousID })
      );
      todos.unshift(action.payload);
      return { ...state, todos: todos };
    case DELETE_TODO:
      todos = _.without(state.todos,
        _.find(state.todos, { id: action.payload.id })
      );
      return { ...state, todos: todos };
    default:
      return state;
  }
}

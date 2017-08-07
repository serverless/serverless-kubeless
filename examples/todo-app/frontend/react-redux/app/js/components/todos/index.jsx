import React, { Component } from 'react';
import { connect } from 'react-redux';
import _ from 'lodash';

import {
  getTodos,
  updateTodo,
  deleteTodo
} from '../../actions/todos';

const noDataAvailableStyles = {
  marginTop: '20px',
  textAlign: 'center'
};

const deleteTodoStyles = {
  marginLeft: '5px'
};

class TodosIndex extends Component {
  componentWillMount() {
    this.props.getTodos();
  }

  deleteTodo(event) {
    event.preventDefault();

    const id = event.currentTarget.getAttribute('data-todo-id');

    if (confirm('Do you really want to delete this todo?')) {
      this.props.deleteTodo(id);
    }
  }

  updateTodo(event) {
    event.preventDefault();

    const id = event.currentTarget.getAttribute('data-todo-id');
    const body = event.currentTarget.innerText;

    const todo = {
      id,
      body
    }

    this.props.updateTodo(todo);
  }

  render() {
    const { todos } = this.props;

    const sortedTodos = todos.length ? _.orderBy(todos, 'updatedAt', ['desc']) : [];

    return (
      <div className="row">
        <div className="six columns offset-by-three">
          {sortedTodos.length ? (
            <ul>
              { sortedTodos.map((todo) => {
                  return (
                      <li key={`todo-${todo.id}`}>
                        <span data-todo-id={todo.id} contentEditable="true" onBlur={this.updateTodo.bind(this)}>{todo.body}</span>
                        <a style={deleteTodoStyles} href='#' data-todo-id={todo.id} onClick={this.deleteTodo.bind(this)}>Delete</a>
                      </li>
                  )
                }
              )}
            </ul>
          ) : <div style={noDataAvailableStyles}>There are currently no todos available to display</div> }
        </div>
      </div>
    )
  }
}

function mapStateToProps(state) {
  return { todos: state.todos.todos };
}

export default connect(mapStateToProps, { getTodos, updateTodo, deleteTodo })(TodosIndex);

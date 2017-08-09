import React, { Component } from 'react';
import { connect } from 'react-redux';

import { createTodo } from '../../actions/todos';

class TodosNew extends Component {
  createTodo(event) {
    event.preventDefault();

    const body = this.refs.body.value;

    const todo = {
      body
    }

    this.props.createTodo(todo).then(this.refs.body.value = '');
  }

  render() {
    return (
      <div className="row">
        <div className="six columns offset-by-three">
          <form onSubmit={this.createTodo.bind(this)}>
            <input type="text" placeholder="Todo" ref="body" className="u-full-width" />
            <input type="submit" className="button button-primary u-full-width" value="Add Todo" />
          </form>
        </div>
      </div>
    );
  }
}

export default connect(null, { createTodo })(TodosNew);

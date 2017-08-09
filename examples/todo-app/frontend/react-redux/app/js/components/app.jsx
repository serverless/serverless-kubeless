import React from 'react';
import { Component } from 'react';

import Error from './shared/error';
import TodosIndex from './todos/index';
import TodosNew from './todos/new';

export default class App extends Component {
  render() {
    return (
      <div>
        <div className="container">
          <Error />

          <TodosNew />
          <TodosIndex />
        </div>
      </div>
    );
  }
}

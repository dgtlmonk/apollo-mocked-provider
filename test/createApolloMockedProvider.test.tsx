import React from 'react';
import { createApolloMockedProvider } from '../src';
import { readFileSync } from 'fs';
import {
  render,
  wait,
  waitForDomChange,
  fireEvent,
} from '@testing-library/react';
import {
  GET_TODO_QUERY,
  GET_TODOS_QUERY,
  GET_TODOS_WITH_CLIENT_RESOLVER_QUERY,
  GetTodo,
  GetTodos,
  Todo,
} from './fixtures/Todo';
import path from 'path';
import { InMemoryCache } from 'apollo-boost';
import { Query } from 'react-apollo';
import { ApolloLink } from 'apollo-link';

const typeDefs = readFileSync(
  path.join(__dirname, 'fixtures/simpleSchema.graphql'),
  'utf8'
);

test('works with defaults', async () => {
  const MockedProvider = createApolloMockedProvider(typeDefs);
  const { getByTestId } = render(
    <MockedProvider>
      <Todo />
    </MockedProvider>
  );

  await waitForDomChange();
  const todoList = getByTestId('todolist');
  expect(todoList).toBeTruthy();
  expect(todoList.children.length).toBeGreaterThanOrEqual(1);
});

test('works with custom resolvers', async () => {
  const MockedProvider = createApolloMockedProvider(typeDefs);
  const { getByText } = render(
    <MockedProvider
      customResolvers={{
        Query: () => ({
          todos: () => [
            {
              text: 'First Todo',
            },
            {
              text: 'Second Todo',
            },
          ],
        }),
      }}
    >
      <Todo />
    </MockedProvider>
  );

  await waitForDomChange();

  expect(getByText('First Todo')).toBeTruthy();
  expect(getByText('Second Todo')).toBeTruthy();
});

test('works with custom links', async () => {
  const linkAction = jest.fn();

  const MockedProvider = createApolloMockedProvider(typeDefs, {
    links: ({ cache, schema }) => [
      new ApolloLink((operation, forward) => {
        linkAction(cache, schema);
        return forward(operation);
      }),
    ],
  });

  render(
    <MockedProvider
      customResolvers={{
        Query: () => ({
          todos: () => [],
        }),
      }}
    >
      <Todo />
    </MockedProvider>
  );

  await waitForDomChange();
  expect(linkAction).toHaveBeenCalledWith(
    expect.objectContaining({ addTypename: true }), // assert that the cache is passed
    expect.objectContaining({ astNode: undefined }) // assert that the schema is passed
  );
});

test('works with client resolvers', async () => {
  const clientResolvers = {
    Todo: {
      text: () => 'client',
    },
  };

  const MockedProvider = createApolloMockedProvider(typeDefs, {
    clientResolvers,
  });

  const { getAllByText } = render(
    <MockedProvider>
      <Query<GetTodos> query={GET_TODOS_WITH_CLIENT_RESOLVER_QUERY}>
        {({ loading, error, data }) => {
          if (loading) return <p>Loading...</p>;
          if (error) return <p>Error!</p>;
          return (
            <>
              <ul data-testid="todolist">
                {data!.todos.map((todo, idx) => (
                  <li key={idx}>{todo.text}</li>
                ))}
              </ul>
            </>
          );
        }}
      </Query>
    </MockedProvider>
  );

  await waitForDomChange();

  expect(getAllByText('client')).toHaveLength(2);
});

test('allows throwing errors within resolvers to mock Query API errors', async () => {
  const MockedProvider = createApolloMockedProvider(typeDefs);
  const { container } = render(
    <MockedProvider
      customResolvers={{
        Query: () => ({
          todo: () => {
            throw new Error('Boom');
          },
          todos: () => [
            {
              text: 'Success',
            },
          ],
        }),
      }}
    >
      <Query<GetTodos> query={GET_TODOS_QUERY}>
        {({ data }) => (
          <div>
            {data && data.todos && data.todos.map(d => d.text)}
            <Query<GetTodo> query={GET_TODO_QUERY} variables={{ id: 'fake' }}>
              {({ error }) => {
                if (error) {
                  return <div>{JSON.stringify(error)}</div>;
                } else {
                  return <div>OKAY</div>;
                }
              }}
            </Query>
          </div>
        )}
      </Query>
    </MockedProvider>
  );

  await waitForDomChange();
  expect(container.textContent).toMatch(/Success/);
  expect(container.textContent).toMatch(/GraphQL error: Boom/);
});

test('allows throwing errors within resolvers to mock Mutation API errors', async () => {
  const MockedProvider = createApolloMockedProvider(typeDefs);
  const { container, getByText } = render(
    <MockedProvider
      customResolvers={{
        Query: () => ({
          todos: () => [
            {
              text: 'First Todo',
            },
            {
              text: 'Second Todo',
            },
          ],
        }),
        Mutation: () => ({
          addTodo: () => {
            throw new Error('Boom');
          },
        }),
      }}
    >
      <Todo />
    </MockedProvider>
  );

  await waitForDomChange();
  fireEvent.click(getByText('Add todo'));
  await waitForDomChange();
  expect(container.textContent).toMatch(/GraphQL error: Boom/);
});

describe('caching', () => {
  test('allows users to provide a global cache', async () => {
    const cache = new InMemoryCache();
    const FirstMockedProvider = createApolloMockedProvider(typeDefs, { cache });
    cache.writeQuery({
      query: GET_TODOS_QUERY,
      data: {
        todos: [
          {
            id: '46e28ed9-1b92-4e1f-9fdf-f1e773dd5448',
            text: 'First Global Todo',
            createdTs: 10,
            __typename: 'Todo',
          },
          {
            id: '5451e580-291c-4a90-bb28-7602bfef64f1',
            text: 'Second Global Todo',
            createdTs: -11,
            __typename: 'Todo',
          },
        ],
      },
    });

    const { getByText } = render(
      <FirstMockedProvider customResolvers={{}}>
        <Todo />
      </FirstMockedProvider>,
      {
        container: document.createElement('div'),
      }
    );

    await wait();
    expect(getByText('First Global Todo')).toBeTruthy();
    expect(getByText('Second Global Todo')).toBeTruthy();

    const SecondMockedProvider = createApolloMockedProvider(typeDefs, {
      cache,
    });
    const { getByText: secondGetByText } = render(
      <SecondMockedProvider>
        <Todo />
      </SecondMockedProvider>,
      {
        container: document.createElement('div'),
      }
    );

    expect(secondGetByText('First Global Todo')).toBeTruthy();
    expect(secondGetByText('Second Global Todo')).toBeTruthy();
  });

  test('allows users to provide a local cache', () => {
    const cache = new InMemoryCache();
    cache.writeQuery({
      query: GET_TODOS_QUERY,
      data: {
        todos: [
          {
            id: '46e28ed9-1b92-4e1f-9fdf-f1e773dd5448',
            text: 'First Local Todo',
            createdTs: 10,
            __typename: 'Todo',
          },
          {
            id: '5451e580-291c-4a90-bb28-7602bfef64f1',
            text: 'Second Local Todo',
            createdTs: -11,
            __typename: 'Todo',
          },
        ],
      },
    });

    const FirstMockedProvider = createApolloMockedProvider(typeDefs);

    const { getByText } = render(
      <FirstMockedProvider cache={cache}>
        <Todo />
      </FirstMockedProvider>
    );

    expect(getByText('First Local Todo')).toBeTruthy();
    expect(getByText('Second Local Todo')).toBeTruthy();
  });

  test('it does not call custom resolvers for cached values. This a document of behavior, not necessarily desired. We may need to build around in the future.', () => {
    const cache = new InMemoryCache();
    cache.writeQuery({
      query: GET_TODOS_QUERY,
      data: {
        todos: [
          {
            id: '46e28ed9-1b92-4e1f-9fdf-f1e773dd5448',
            text: 'First Local Todo',
            createdTs: 10,
            __typename: 'Todo',
          },
          {
            id: '5451e580-291c-4a90-bb28-7602bfef64f1',
            text: 'Second Local Todo',
            createdTs: -11,
            __typename: 'Todo',
          },
        ],
      },
    });

    const FirstMockedProvider = createApolloMockedProvider(typeDefs);

    const { getByText } = render(
      <FirstMockedProvider
        customResolvers={{
          Query: () => {
            return {
              todos: () => [
                {
                  text: 'First Todo',
                },
                {
                  text: 'Second Todo',
                },
              ],
            };
          },
        }}
        cache={cache}
      >
        <Todo />
      </FirstMockedProvider>
    );

    expect(getByText('First Local Todo')).toBeTruthy();
    expect(getByText('Second Local Todo')).toBeTruthy();
  });

  test('allows user to provide a custom provider', () => {
    const MyCustomProvider = jest.fn(() => <div />);

    const CustomizedProvider = createApolloMockedProvider(typeDefs, {
      provider: MyCustomProvider,
    });
    render(<CustomizedProvider> </CustomizedProvider>);
    expect(MyCustomProvider).toHaveBeenCalled();
  });
});

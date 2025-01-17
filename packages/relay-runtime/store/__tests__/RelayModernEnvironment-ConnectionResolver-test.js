/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @flow
 * @emails oncall+relay
 */

'use strict';

const RelayFeatureFlags = require('../../util/RelayFeatureFlags');
const RelayModernEnvironment = require('../RelayModernEnvironment');
const RelayModernStore = require('../RelayModernStore');
const RelayNetwork = require('../../network/RelayNetwork');
const RelayObservable = require('../../network/RelayObservable');
const RelayRecordSource = require('../RelayRecordSource');

const invariant = require('invariant');
const nullthrows = require('nullthrows');

const {
  createOperationDescriptor,
} = require('../RelayModernOperationDescriptor');
const {getSingularSelector} = require('../RelayModernSelector');
const {generateAndCompile} = require('relay-test-utils-internal');

import type {ConnectionResolver} from '../RelayConnection';

type ConnectionEdge = {|
  +cursor: ?string,
|};
type ConnectionState = {|
  +edges: $ReadOnlyArray<?ConnectionEdge>,
  +pageInfo: {
    endCursor: ?string,
    hasNextPage: ?boolean,
    hasPrevPage: ?boolean,
    startCursor: ?string,
  },
|};

describe('@connection_resolver connection field', () => {
  let CommentCreateMutation;
  let connectionResolver: ConnectionResolver<ConnectionEdge, ConnectionState>;
  let callbacks;
  let complete;
  let dataSource;
  let environment;
  let error;
  let fetch;
  let fragment;
  let next;
  let operation;
  let paginationQuery;
  let query;
  let source;
  let store;

  let enableConnectionResolvers;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('warning');
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    enableConnectionResolvers = RelayFeatureFlags.ENABLE_CONNECTION_RESOLVERS;
    RelayFeatureFlags.ENABLE_CONNECTION_RESOLVERS = true;

    connectionResolver = {
      initialize() {
        return {
          edges: [],
          pageInfo: {
            endCursor: null,
            hasNextPage: null,
            hasPrevPage: null,
            startCursor: null,
          },
        };
      },
      reduce(state, event) {
        switch (event.kind) {
          case 'fetch': {
            const {args} = event;
            if (args.after != null) {
              return {
                edges: [...state.edges, ...event.edges],
                pageInfo: {
                  ...state.pageInfo,
                  endCursor: event.pageInfo.endCursor,
                  hasNextPage: event.pageInfo.hasNextPage,
                },
              };
            } else if (args.before != null) {
              return {
                edges: [...event.edges, ...state.edges],
                pageInfo: {
                  ...state.pageInfo,
                  hasPrevPage: event.pageInfo.hasPrevPage,
                  startCursor: event.pageInfo.startCursor,
                },
              };
            } else {
              // initial fetch or refetch
              return {
                edges: event.edges,
                pageInfo: event.pageInfo,
              };
            }
          }
          case 'insert': {
            return {
              edges: [...state.edges, event.edge],
              pageInfo: {
                ...state.pageInfo,
                endCursor: event.edge.cursor ?? state.pageInfo.endCursor,
              },
            };
          }
          default:
            (event.kind: empty);
            invariant(
              false,
              'ConnectionResolver-test: Unhandled event kind `%s`.',
              event.kind,
            );
        }
      },
    };
    ({
      CommentCreateMutation,
      FeedbackQuery: query,
      FeedbackFragment: fragment,
      PaginationQuery: paginationQuery,
    } = generateAndCompile(
      `
      query FeedbackQuery($id: ID!) {
        node(id: $id) {
          ...FeedbackFragment
        }
      }

      mutation CommentCreateMutation($input: CommentCreateInput) {
        commentCreate(input: $input) {
          feedbackCommentEdge {
            cursor
            node {
              id
              message { text }
            }
          }
        }
      }

      query PaginationQuery(
        $id: ID!
        $count: Int
        $cursor: ID
        $beforeCount: Int
        $beforeCursor: ID
      ) {
        node(id: $id) {
          ...FeedbackFragment @arguments(
            count: $count
            cursor: $cursor
            beforeCount: $beforeCount
            beforeCursor: $beforeCursor
          )
        }
      }

      fragment FeedbackFragment on Feedback @argumentDefinitions(
        count: {type: "Int", defaultValue: 2},
        cursor: {type: "ID"}
        beforeCount: {type: "Int"},
        beforeCursor: {type: "ID"}
      ) {
        id
        comments(
          after: $cursor
          before: $beforeCursor
          first: $count
          last: $beforeCount
          orderby: "date"
        ) @connection_resolver(resolver: "connectionResolver") {
          edges {
            cursor
            node {
              id
              message { text }
              ...CommentFragment
            }
          }
          pageInfo {
            endCursor
            hasNextPage
            hasPreviousPage
            startCursor
          }
        }
      }

      fragment CommentFragment on Comment {
        id
      }
    `,
      null,
      {
        connectionResolver,
      },
    ));
    const variables = {
      id: '<feedbackid>',
    };
    operation = createOperationDescriptor(query, variables);

    complete = jest.fn();
    error = jest.fn();
    next = jest.fn();
    callbacks = {complete, error, next};
    fetch = jest.fn((_query, _variables, _cacheConfig) => {
      return RelayObservable.create(sink => {
        dataSource = sink;
      });
    });
    source = RelayRecordSource.create();
    store = new RelayModernStore(source);
    environment = new RelayModernEnvironment({
      network: RelayNetwork.create(fetch),
      store,
    });
  });

  afterEach(() => {
    RelayFeatureFlags.ENABLE_CONNECTION_RESOLVERS = enableConnectionResolvers;
  });

  it('loads the resolver object for a ConnectionField', () => {
    const connectionField = fragment.selections.find(
      selection => selection.kind === 'ConnectionField',
    );
    expect(connectionField.name).toBe('comments');
    expect(connectionField.label).toBe('FeedbackFragment$connection$comments');
    expect(connectionField.resolver).toBe(connectionResolver);
  });

  it('publishes initial results to the store', () => {
    const operationSnapshot = environment.lookup(operation.fragment);
    const operationCallback = jest.fn();
    environment.subscribe(operationSnapshot, operationCallback);

    environment.execute({operation}).subscribe(callbacks);
    const payload = {
      data: {
        node: {
          __typename: 'Feedback',
          id: '<feedbackid>',
          comments: {
            edges: [
              {
                cursor: 'cursor-1',
                node: {
                  __typename: 'Comment',
                  id: 'node-1',
                  message: {text: 'Comment 1'},
                },
              },
              {
                cursor: 'cursor-2',
                node: {
                  __typename: 'Comment',
                  id: 'node-2',
                  message: {text: 'Comment 2'},
                },
              },
            ],
            pageInfo: {
              endCursor: 'cursor-2',
              hasNextPage: true,
              hasPreviousPage: null,
              startCursor: 'cursor-1',
            },
          },
        },
      },
    };
    dataSource.next(payload);
    jest.runAllTimers();

    expect(callbacks.error.mock.calls.map(call => call[0].message)).toEqual([]);
    expect(operationCallback).toBeCalledTimes(1);
    const nextOperationSnapshot = operationCallback.mock.calls[0][0];
    expect(nextOperationSnapshot.isMissingData).toBe(false);
    expect(nextOperationSnapshot.data).toEqual({
      node: {
        __id: '<feedbackid>',
        __fragments: {
          FeedbackFragment: {},
        },
        __fragmentOwner: operation.request,
      },
    });

    const selector = nullthrows(
      getSingularSelector(fragment, nextOperationSnapshot.data?.node),
    );
    const snapshot = environment.lookup(selector);
    expect(snapshot.isMissingData).toBe(false);
    expect(snapshot.data).toEqual({
      id: '<feedbackid>',
      comments: {
        __connection: expect.objectContaining({
          id: 'connection:<feedbackid>:FeedbackFragment$connection$comments',
        }),
      },
    });
    const connectionSnapshot = environment
      .getStore()
      .lookupConnection_UNSTABLE(
        (snapshot.data: $FlowFixMe).comments.__connection,
      );
    expect(connectionSnapshot.state).toEqual({
      edges: [
        {
          cursor: 'cursor-1',
          node: {
            id: 'node-1',
            message: {text: 'Comment 1'},
            __fragmentOwner: operation.request,
            __fragments: {CommentFragment: {}},
            __id: 'node-1',
          },
        },
        {
          cursor: 'cursor-2',
          node: {
            id: 'node-2',
            message: {text: 'Comment 2'},
            __fragmentOwner: operation.request,
            __fragments: {CommentFragment: {}},
            __id: 'node-2',
          },
        },
      ],
      pageInfo: {
        endCursor: 'cursor-2',
        hasNextPage: true,
        hasPrevPage: null,
        startCursor: 'cursor-1',
      },
    });
  });

  describe('after initial data has been fetched and subscribed', () => {
    let callback;
    let connectionCallback;
    let connectionSnapshot;

    beforeEach(() => {
      environment.execute({operation}).subscribe(callbacks);
      const payload = {
        data: {
          node: {
            __typename: 'Feedback',
            id: '<feedbackid>',
            comments: {
              edges: [
                {
                  cursor: 'cursor-1',
                  node: {
                    __typename: 'Comment',
                    id: 'node-1',
                    message: {text: 'Comment 1'},
                  },
                },
                {
                  cursor: 'cursor-2',
                  node: {
                    __typename: 'Comment',
                    id: 'node-2',
                    message: {text: 'Comment 2'},
                  },
                },
              ],
              pageInfo: {
                endCursor: 'cursor-2',
                hasNextPage: true,
                hasPreviousPage: null,
                startCursor: 'cursor-1',
              },
            },
          },
        },
      };
      dataSource.next(payload);
      dataSource.complete();
      fetch.mockClear();
      jest.runAllTimers();

      const operationSnapshot = environment.lookup(operation.fragment);

      const selector = nullthrows(
        getSingularSelector(fragment, operationSnapshot.data?.node),
      );
      const snapshot = environment.lookup(selector);
      callback = jest.fn();
      environment.subscribe(snapshot, callback);

      connectionSnapshot = environment
        .getStore()
        .lookupConnection_UNSTABLE(
          (snapshot.data: $FlowFixMe).comments.__connection,
        );
      connectionCallback = jest.fn();
      environment
        .getStore()
        .subscribeConnection_UNSTABLE(connectionSnapshot, connectionCallback);
    });

    it('updates when paginated forward', () => {
      const paginationOperation = createOperationDescriptor(paginationQuery, {
        id: '<feedbackid>',
        count: 2,
        cursor: 'cursor-2',
      });
      environment.execute({operation: paginationOperation}).subscribe({});
      const paginationPayload = {
        data: {
          node: {
            __typename: 'Feedback',
            id: '<feedbackid>',
            comments: {
              edges: [
                {
                  cursor: 'cursor-3',
                  node: {
                    __typename: 'Comment',
                    id: 'node-3',
                    message: {text: 'Comment 3'},
                  },
                },
                {
                  cursor: 'cursor-4',
                  node: {
                    __typename: 'Comment',
                    id: 'node-4',
                    message: {text: 'Comment 4'},
                  },
                },
              ],
              pageInfo: {
                endCursor: 'cursor-4',
                hasNextPage: true,
                hasPreviousPage: null,
                startCursor: 'cursor-3',
              },
            },
          },
        },
      };
      dataSource.next(paginationPayload);
      jest.runAllTimers();

      expect(callback).toBeCalledTimes(0);

      expect(connectionCallback).toBeCalledTimes(1);
      const nextSnapshot = connectionCallback.mock.calls[0][0];
      expect(nextSnapshot).toEqual({
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              id: 'node-1',
              message: {text: 'Comment 1'},
              __fragmentOwner: operation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-1',
            },
          },
          {
            cursor: 'cursor-2',
            node: {
              id: 'node-2',
              message: {text: 'Comment 2'},
              __fragmentOwner: operation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-2',
            },
          },
          {
            cursor: 'cursor-3',
            node: {
              id: 'node-3',
              message: {text: 'Comment 3'},
              __fragmentOwner: paginationOperation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-3',
            },
          },
          {
            cursor: 'cursor-4',
            node: {
              id: 'node-4',
              message: {text: 'Comment 4'},
              __fragmentOwner: paginationOperation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-4',
            },
          },
        ],
        pageInfo: {
          endCursor: 'cursor-4',
          hasNextPage: true,
          hasPrevPage: null,
          startCursor: 'cursor-1',
        },
      });
    });

    it('updates when paginated backward', () => {
      const paginationOperation = createOperationDescriptor(paginationQuery, {
        id: '<feedbackid>',
        beforeCount: 2,
        beforeCursor: 'cursor-1',
      });
      environment.execute({operation: paginationOperation}).subscribe({});
      const paginationPayload = {
        data: {
          node: {
            __typename: 'Feedback',
            id: '<feedbackid>',
            comments: {
              edges: [
                {
                  cursor: 'cursor-y',
                  node: {
                    __typename: 'Comment',
                    id: 'node-y',
                    message: {text: 'Comment Y'},
                  },
                },
                {
                  cursor: 'cursor-z',
                  node: {
                    __typename: 'Comment',
                    id: 'node-z',
                    message: {text: 'Comment Z'},
                  },
                },
              ],
              pageInfo: {
                endCursor: 'cursor-z',
                hasNextPage: true,
                hasPreviousPage: true,
                startCursor: 'cursor-y',
              },
            },
          },
        },
      };
      dataSource.next(paginationPayload);
      jest.runAllTimers();

      expect(callback).toBeCalledTimes(0);

      expect(connectionCallback).toBeCalledTimes(1);
      const nextSnapshot = connectionCallback.mock.calls[0][0];
      expect(nextSnapshot).toEqual({
        edges: [
          {
            cursor: 'cursor-y',
            node: {
              id: 'node-y',
              message: {text: 'Comment Y'},
              __fragmentOwner: paginationOperation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-y',
            },
          },
          {
            cursor: 'cursor-z',
            node: {
              id: 'node-z',
              message: {text: 'Comment Z'},
              __fragmentOwner: paginationOperation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-z',
            },
          },
          {
            cursor: 'cursor-1',
            node: {
              id: 'node-1',
              message: {text: 'Comment 1'},
              __fragmentOwner: operation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-1',
            },
          },
          {
            cursor: 'cursor-2',
            node: {
              id: 'node-2',
              message: {text: 'Comment 2'},
              __fragmentOwner: operation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-2',
            },
          },
        ],
        pageInfo: {
          endCursor: 'cursor-2',
          hasNextPage: true,
          hasPrevPage: true,
          startCursor: 'cursor-y',
        },
      });
    });

    it('resets state when refetched', () => {
      const refetchOperation = createOperationDescriptor(paginationQuery, {
        id: '<feedbackid>',
        count: 2,
        cursor: null,
      });
      environment.execute({operation: refetchOperation}).subscribe({});
      const refetchPayload = {
        data: {
          node: {
            __typename: 'Feedback',
            id: '<feedbackid>',
            comments: {
              edges: [
                {
                  cursor: 'cursor-1a',
                  node: {
                    __typename: 'Comment',
                    id: 'node-1a',
                    message: {text: 'Comment 1A'},
                  },
                },
                {
                  cursor: 'cursor-2a',
                  node: {
                    __typename: 'Comment',
                    id: 'node-2a',
                    message: {text: 'Comment 2A'},
                  },
                },
              ],
              pageInfo: {
                endCursor: 'cursor-2a',
                hasNextPage: true,
                hasPreviousPage: null,
                startCursor: 'cursor-1a',
              },
            },
          },
        },
      };
      dataSource.next(refetchPayload);
      jest.runAllTimers();

      expect(callback).toBeCalledTimes(0);

      expect(connectionCallback).toBeCalledTimes(1);
      const nextSnapshot = connectionCallback.mock.calls[0][0];
      expect(nextSnapshot).toEqual({
        edges: [
          {
            cursor: 'cursor-1a',
            node: {
              id: 'node-1a',
              message: {text: 'Comment 1A'},
              __fragmentOwner: refetchOperation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-1a',
            },
          },
          {
            cursor: 'cursor-2a',
            node: {
              id: 'node-2a',
              message: {text: 'Comment 2A'},
              __fragmentOwner: refetchOperation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-2a',
            },
          },
        ],
        pageInfo: {
          endCursor: 'cursor-2a',
          hasNextPage: true,
          hasPrevPage: null,
          startCursor: 'cursor-1a',
        },
      });
    });

    it('updates when a node is deleted', () => {
      environment.commitUpdate(storeProxy => {
        storeProxy.delete('node-1');
      });
      expect(connectionCallback).toBeCalledTimes(1);
      const nextSnapshot = connectionCallback.mock.calls[0][0];
      expect(nextSnapshot).toEqual({
        edges: [
          {cursor: 'cursor-1', node: null},
          {
            cursor: 'cursor-2',
            node: {
              id: 'node-2',
              message: {text: 'Comment 2'},
              __fragmentOwner: operation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-2',
            },
          },
        ],
        pageInfo: {
          endCursor: 'cursor-2',
          hasNextPage: true,
          hasPrevPage: null,
          startCursor: 'cursor-1',
        },
      });
    });

    it('updates when an edge is deleted', () => {
      const edgeID =
        'client:<feedbackid>:comments(first:2,orderby:"date"):edges:0';
      environment.commitUpdate(storeProxy => {
        storeProxy.delete(edgeID);
      });
      expect(connectionCallback).toBeCalledTimes(1);
      const nextSnapshot = connectionCallback.mock.calls[0][0];
      expect(nextSnapshot).toEqual({
        edges: [
          null,
          {
            cursor: 'cursor-2',
            node: {
              id: 'node-2',
              message: {text: 'Comment 2'},
              __fragmentOwner: operation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-2',
            },
          },
        ],
        pageInfo: {
          endCursor: 'cursor-2',
          hasNextPage: true,
          hasPrevPage: null,
          startCursor: 'cursor-1',
        },
      });
    });

    // eslint-disable-next-line jest/no-disabled-tests
    xit('updates when an edge is inserted', () => {
      const payload = {
        data: {
          commentCreate: {
            feedbackCommentEdge: {
              cursor: 'cursor-3',
              node: {
                id: 'node-3',
                message: {text: 'Comment 3'},
              },
            },
          },
        },
        extensions: {
          is_final: true,
        },
      };
      const updater = jest.fn(storeProxy => {
        const commentCreate = storeProxy.getRootField('commentCreate');
        invariant(commentCreate, 'Expected `commentCreate` to exist');
        const edge = commentCreate.getLinkedRecord('feedbackCommentEdge');
        invariant(edge, 'Expected `feedbackCommentEdge` to exist');
        // TODO: insert an edge from an updater (or a better alternative!)
        // storeProxy.insertConnectionEdge(connectionSnapshot.id, {}, edge);
      });
      const mutation = createOperationDescriptor(CommentCreateMutation, {});
      environment
        .executeMutation({operation: mutation, updater})
        .subscribe(callbacks);
      dataSource.next(payload);

      expect(updater).toBeCalledTimes(1);
      expect(error.mock.calls.map(call => call[0].stack)).toEqual([]);
      expect(connectionCallback).toBeCalledTimes(1);
      const nextSnapshot = connectionCallback.mock.calls[0][0];
      expect(nextSnapshot).toEqual({
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              id: 'node-1',
              message: {text: 'Comment 1'},
              __fragmentOwner: operation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-1',
            },
          },
          {
            cursor: 'cursor-2',
            node: {
              id: 'node-2',
              message: {text: 'Comment 2'},
              __fragmentOwner: operation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-2',
            },
          },
          {
            cursor: 'cursor-3',
            node: {
              id: 'node-3',
              message: {text: 'Comment 3'},
              __fragmentOwner: mutation.request,
              __fragments: {CommentFragment: {}},
              __id: 'node-3',
            },
          },
        ],
        pageInfo: {
          endCursor: 'cursor-3',
          hasNextPage: true,
          hasPrevPage: null,
          startCursor: 'cursor-1',
        },
      });
    });
  });
});

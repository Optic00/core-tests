// Reactive stand-in for the class-based collectionStore so tests can replace
// the items array the way a completed-toggle reload does.

export function createCollectionStoreMock() {
  let items = $state([]);
  let loading = $state(false);
  let collectionName = $state('Default');
  let collectionTotal = $state(null);
  let itemsPagination = $state(null);

  return {
    get items() {
      return items;
    },
    set items(value) {
      items = value;
    },
    get loading() {
      return loading;
    },
    set loading(value) {
      loading = value;
    },
    get collectionName() {
      return collectionName;
    },
    set collectionName(value) {
      collectionName = value;
    },
    get collectionTotal() {
      return collectionTotal;
    },
    set collectionTotal(value) {
      collectionTotal = value;
    },
    get itemsPagination() {
      return itemsPagination;
    },
    set itemsPagination(value) {
      itemsPagination = value;
    },
  };
}

export const collectionTreeStore = createCollectionStoreMock();

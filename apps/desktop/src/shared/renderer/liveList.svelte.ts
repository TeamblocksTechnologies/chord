import { onMount } from "svelte";

/** Subscribe before reading the initial list; a slow initial read must not overwrite a live update. */
export class LiveList<T> {
  list = $state<T[]>([]);
  loaded = $state(false);

  constructor(load: () => Promise<T[]>, subscribe: (receive: (list: T[]) => void) => () => void) {
    onMount(() => {
      let active = true;
      let received = false;
      const receive = (list: T[]) => {
        if (active) {
          this.list = list;
          this.loaded = true;
        }
      };
      const off = subscribe((list) => {
        received = true;
        receive(list);
      });
      void load()
        .then((list) => {
          if (!received) receive(list);
        })
        .catch(() => {});
      return () => {
        active = false;
        off();
      };
    });
  }
}

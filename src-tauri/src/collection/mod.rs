pub mod model;
pub mod manager;
pub mod archive;

pub use model::{Collection, Entry};
pub use manager::{
    delete_collection, get_all_collections, get_collections_dir, load_collection, save_collection,
    add_entry_to_collection, remove_entry_from_collection, move_entry_in_collection,
};


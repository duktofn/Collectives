pub mod model;
pub mod manager;

pub use model::{Collection, Entry};
pub use manager::{
    delete_collection, get_all_collections, get_collections_dir, load_collection, save_collection,
};

pub const REDIS_ADDRESS_ENV: &str = "SPIN_APP_REDIS_ADDRESS";

pub fn value_contains_uuid(value: &[u8], uuid: &[u8]) -> bool {
    let mut throwaway = false;
    let mut uuid_iter = uuid.iter();
    for item in value.iter() {
        if item == &b',' {
            uuid_iter = uuid.iter();
            if throwaway {
                throwaway = false;
                continue;
            } else {
                return true;
            }
        } else if let Some(uuid_item) = uuid_iter.next() {
            if item != uuid_item {
                throwaway = true;
            }
        }
    }

    false
}

pub fn filter_for_uuid<'a>(value: &[u8], uuid: &[u8]) -> Vec<u8> {
    let mut throwaway = false;
    let mut uuid_iter = uuid.iter();
    let mut buffer = vec![];
    let mut out = vec![];
    for item in value.iter() {
        buffer.push(*item);
        if item == &b',' {
            uuid_iter = uuid.iter();
            if throwaway {
                throwaway = false;
                out.append(&mut buffer);
                continue;
            } else {
                buffer.clear();
            }
        } else if let Some(uuid_item) = uuid_iter.next() {
            if item != uuid_item {
                throwaway = true;
            }
        }
    }

    out
}

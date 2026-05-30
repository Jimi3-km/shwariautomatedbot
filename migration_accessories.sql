-- =========================================
-- SHWARI ACCESSORIES SUPABASE SCHEMA
-- =========================================

create table if not exists accessories (
    id uuid primary key default gen_random_uuid(),

    brand text not null,
    accessory_name text not null,
    price integer not null,

    currency text default 'KES',
    stock integer default 0,

    description text,
    image_url text,

    is_featured boolean default false,
    is_available boolean default true,

    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- =========================================
-- INDEXES
-- =========================================

create index if not exists idx_accessories_brand on accessories(brand);
create index if not exists idx_accessories_price on accessories(price);
create index if not exists idx_accessories_name on accessories(accessory_name);

-- =========================================
-- UPDATED_AT TRIGGER
-- =========================================

create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists update_accessories_updated_at on accessories;
create trigger update_accessories_updated_at
before update on accessories
for each row
execute function update_updated_at_column();

-- =========================================
-- INSERT DATA
-- =========================================

insert into accessories (brand, accessory_name, price) values
('iPhone', 'Rhode Cover (iPhone)', 1000),
('Samsung', 'Rhode Cover (Samsung)', 1000),
('iPhone', 'Silicone Cover (iPhone)', 600),
('iPhone', 'USB-C Adapter - 20W', 1000),
('iPhone', 'USB-C Adapter - 35W', 1700),
('iPhone', 'USB A - Lightning Cable', 300),
('Others', '3 in 1 Wireless Charger', 5500),
('iPhone', 'Wireless Charger iPhone', 2500),
('iPhone', 'iPhone Earphones (Lightning)', 1500),
('iPhone', 'USB C - Lightning Cable', 500),
('Others', 'Universal Stylus Pen', 2500),
('iPhone', 'iPhone Camera Lens', 500),
('iPhone', 'Vacuum Magnetic Phone Stand', 2500),
('Samsung', 'Wireless Charger Samsung', 1500),
('Apple', 'Apple Watch Silicone Straps', 2500),
('Apple', 'Apple Watch Chargers', 2500),
('Apple', 'Apple Pencil Case', 1000),
('Apple', 'Apple Watch Stainless Steel Straps', 3000),
('Others', 'USB-C HDTV Multifunction Adapter', 3000),
('Others', 'Travel Portable Stand', 1500),
('Apple', 'Airpod Cases', 500),
('Apple', 'iPhone Pocket', 3000),
('Apple', 'Apple Pencil Sticker', 1000),
('Apple', 'iPhone North Face Covers', 800),
('Samsung', 'Samsung C-C Cables', 1000),
('Apple', 'Active Stylus Pen', 3500),
('Others', 'Power Bank', 1500),
('Apple', 'iPad Covers', 2500),
('Others', 'Micro-Data Cables', 300),
('Samsung', 'Samsung 25W Charger', 1500),
('Samsung', 'Samsung 25W Adapter', 800),
('iPhone', 'Calculator Phone Cases', 600),
('iPhone', 'Magsafe Cases', 1000),
('Samsung', 'Screen Protectors (Samsung)', 300),
('Samsung', 'Screen Protectors (Flue-Glue) S-Series Samsung', 500),
('Samsung', 'Screen Protectors (Samsung Curved)', 1000),
('iPhone', 'Screen Protectors (iPhone)', 300),
('iPhone', 'Screen Protectors (iPhone 15 & Above)', 500),
('Others', 'Fast Wireless Charger', 1500),
('Others', 'Watch Film', 800),
('Samsung', 'Note 20 Ultra Spen', 3500),
('Samsung', 'S22 Ultra S Pen', 3500),
('Samsung', 'Samsung Watch Wireless Charger (JW14)', 2500),
('Samsung', 'Samsung Watch 7-8 Straps', 2500),
('Samsung', 'Samsung Tab S-Pen', 2000),
('Samsung', 'Tab S-Pen - Pressure Detection', 2500),
('iPhone', 'Octobuddy', 400),
('Others', 'Laptop Stand', 1500),
('Apple', 'Fancy iPad Covers', 3000),
('iPhone', 'Snap-On Case', 1500),
('Others', 'Pixel 7A Covers', 600),
('Others', 'S20 FE Covers', 600),
('Apple', 'iPad Keyboards 11"', 12500),
('Apple', 'iPad Keyboards 11th Gen and 10th Gen', 12500),
('Apple', 'iPad Keyboards 13"', 15000),
('Samsung', 'Samsung Earphones', 1500),
('Others', 'Charms', 350),
('Others', 'USB A to C Android', 300),
('Apple', 'Active Stylus iPad Pencil', 3500),
('iPhone', 'Silicone Cover (iPhone)', 600),
('Samsung', 'Silicone Cover (Samsung)', 600),
('Apple', 'Silicone Case (iPad With Pen Slot)', 2500),
('Apple', 'Pen Tips', 750),
('Apple', 'USB-C to USB-C (2m)', 2000),
('Apple', 'iPad Screen Protector', 1500)
on conflict do nothing;

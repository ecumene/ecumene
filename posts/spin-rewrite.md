---
slug = "spin"
title = "This site is now served by WASM"
description = "I now use Fermyon Spin to host my site"
created_date = "2022-06-5"
last_modified_date = "2022-06-5"
---

# My Rust obsession

For the past 4 years I've been borderline obsessed with Rust, but ever since I
started with Java in 2009 I've always wanted learn C++. C++ is attractive to me
because of the APIs you can access like Vulkan, and the WinAPI. It's also a
lower ring of abstraction which gives you greater control than when dealing with
those APIs via the JNI. However, with great power comes great due diligence, and
therefore to write **good** C++ you need years or even decades of experience.

<mitchsplain> This is only somewhat true, there are really good static analysis
tools for it that stop you from doing things that are not idiomatic. </mitchsplain>

Rust's abstractions allow for the performance and power of C++ but with the
safety of Java. On top of that its expressive type system and ecosystem of high-
quality crates make it my first choice for projects where "I know what I'm
doing". I prefer starting a project with either Golang or Javascript then once
I have what I want, I rewrite it in Rust.

It's not a silver bullet, nor invincible to bad code. It's not even a good
language to learn if you want a job writing it because the companies willing to
invest in a full-time position writing Rust can fit on a single page. Unless you
want a job in Crypto (good luck with that)

# The Rust backend story is challenging

The marketing around "Fearless Concurrency" is right. When you compile a Safe
Rust program it is data-race free. But when you are dealing with a problem that
involves communication between "threads" like backend development you run into
quite a few `E0382`s.

### `E0382` A variable was used after its contents have been moved elsewhere.

<mitchsplain>
THINK FAST 💥 :borrowcheck: 💥
</mitchsplain>

```rust
error[E0382]: capture of moved value: `counter`
  --> src/main.rs:10:27
   |
9  |         let handle = thread::spawn(move || {
   |                                    ------- value moved (into closure) here
10 |             let mut num = counter.lock().unwrap();
   |                           ^^^^^^^ value captured here after move
   |
   = note: move occurs because `counter` has type `std::sync::Mutex<i32>`,
   which does not implement the `Copy` trait

error[E0382]: use of moved value: `counter`
  --> src/main.rs:21:29
   |
9  |         let handle = thread::spawn(move || {
   |                                    ------- value moved (into closure) here
...
21 |     println!("Result: {}", *counter.lock().unwrap());
   |                             ^^^^^^^ value used here after move
   |
   = note: move occurs because `counter` has type `std::sync::Mutex<i32>`,
   which does not implement the `Copy` trait

error: aborting due to 2 previous errors
```

When working with the web, your program is going to move a lot of data around.
Say for example data from a TCP socket to a handler, or from an in-memory cache
to a function, or from a database to your client. There are generally two ways
to communicate when in an async context. Sharing memory or sharing messages.
Sharing messages usually involves copying or cloning and sharing memory
sometimes involves `E0382`.

> I'm still new to this. If you believe this is a mischaracterization
> [submit a PR](https://github.com/ecumene/ecumene)

There are a few web frameworks that make this a non-issue. One of my favourites
is [warp](https://github.com/seanmonstar/warp). Even with frameworks, sharing
data can be challenging. Out of the box, a Golang webserver is easier to write,
serialization is built into the standard library, and it's faster than most Rust
frameworks without configuration. This makes Rust a less desirable language for
the web.

<mitchsplain>Comparing Rust to Golang or Javascript is comparing apples to 2003
Toyota Corolla. What's limiting Rust right now is commercial adoption in the web
space. Golang + Javascript have thousands of people making the web experience
better. Rust will get there soon.</mitchsplain>

Rust excels at being small, correct, and efficient. These things are desirable
if you're making a parser, a language runtime, or...

# WebAssembly: neither web nor assembly

WebAssembly (WASM) is a target meant for languages like Rust, Go, C/C++ to run
in the web browser. It's like the JVM: It's built in and runs code. Unlike the
JVM it has very limited access to... anything really. It's just an environment
to run code. Whatever you expose to it, it can use.

WebAssembly System Interface (WASI) is actually more comparable to the JVM.
Well err.., it's more like it's comparable to some spec that the JVM would
aspire to[^1]. WASI allows you to make things like syscalls for an operating
system and handle them _inside your runtime._

## FaaaaaS

FaaS is cool. It lets you execute code in response to events without all the
complicated networking code you're used to. It also forces you to think about
writing web servers different from a conceptual level. Your function is pure
inputs and outputs with minimal side-effects. The input (generally) is an HTTP
request and the output (even more generally) is an HTTP response.

You could also do DNS, file events, scheduled/cron... The point of FaaS is that
you don't care how the event is getting to you. You care about what to do with
it before you return.

I've wanted to make a FaaS (Function as a Service) implementation for about a
year now. Thanks to the Orange Site, I found out
[someone beat me to it](https://github.com/fermyon/spin). Spin is just what I
wanted to build but with a _team of señor engineers working full time_ behind
it.

## Rust excels at WASM-FaaS

Rust has a minimal runtime, which makes it a good language to write application-
level FaaS code in. When compiled to WASM, the run-of-the-mill Rust program will
be smaller than the average Golang binary which comes packaged with a garbage
collector.

<mitchsplain>A garbage collector is a program that runs next to your program,
cleaning up after you. Rust doesn't have one, which makes binaries smaller.
</mitchsplain>

This is makes Rust a good language to write FaaS apps in because the function
must parse the entire binary before running. The smaller the binary, the smaller
the `ms` to return data. This is an improvement of the the "cold-start" time
which is the time it takes for your function to start from scratch. Some FaaS
runtimes like Lambda keep a few functions "warm" so all they have to do is
handle a invocation, not load the code + environment again. This reduces
latency.

Since networking is abstracted away, your code ends up being much simpler to
follow, in fact here's the function signature for a basic HTTP component.

```rust
#[http_component]
fn handler(req: Request) -> Result<Response> {
    ...
}
```

Aside from the magic macro, there's not much swept under the rug here.

# [`@fermyon/spin`](https://github.com/fermyon/spin)

Spin is a WASM microservice framework. Instead of containerized apps Spin runs
WASM programs to handle application code. There are lots of benefits for using
this approach, but a notable one for me is that Spin can be run on a very small
VM, and consumes far less resources than say Firecracker VMs.

![A diagram of spin. Read along for an explaination](/spin-diagram.png)

You interact with the HTTP Trigger, and make a request. Then that trigger parses
the request and interprets it. Say you made a request to `/cats`, that would
invoke a different handler than `/dogs` for example. Then it calls some
functions in the `spin_engine`. The engine's responsibility is to simply run
and instantiate WASM modules.

## My site in Spin

My site has two components: a like microservice, and a static file webserver.

### `/static`

- Serves the built product of my static site generator
- Handles `GET /*`

```toml
[[component]]
files = [{source = "public/", destination = "/"}]
id = "static"
source = "functions/static/target/wasm32-wasi/release/static.wasm"
[component.trigger]
route = "/..."
[component.build]
command = "cargo run && cd functions/static && cargo build --target wasm32-wasi --release"
```

### `/likes`

- Serves the built product of my static site generator
- Handles `POST/GET /likes`

<mitchsplain>
The likes microservice stops you from making a like request to a page that's not
in the sitemap. It does this by downloading the sitemap from
mitchellhynes.com/sitemap.xml.
</mitchsplain>

```toml
[[component]]
allowed_http_hosts = ["https://mitchellhynes.com/"]
environment = {JWT_SECRET = "{{ jwt_secret }}", REDIS_ADDRESS = "{{ redis_address }}", REDIS_CHANNEL = "messages"}
id = "likes"
source = "functions/tokenize/target/wasm32-wasi/release/tokenize.wasm"
[component.trigger]
route = "/likes"
```

# Conclusion

Spin is great, but it's still in its early stages. What I'm excited about is its
potential. WASM enables truly portable code to run on any platform. With the
features coming down the pipe like Interface Types, and WASM Components I can
see this becoming a new wave for cloud computing.

---

[^1]: [The JVM Spec](https://docs.oracle.com/javase/specs/jvms/se7/html/)

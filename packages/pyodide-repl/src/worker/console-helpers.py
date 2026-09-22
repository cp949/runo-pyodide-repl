import builtins, traceback
from pyodide.ffi import to_js

async def await_fut(fut):
    try:
        res = await fut
    except SystemExit:
        return to_js([None, True, None], depth=1)
    if res is None:
        return to_js([None, False, None], depth=1)
    try:
        text = repr(res)
    except Exception as e:
        # 첫 프레임(이 함수)을 떼고 __repr__ 프레임부터 남긴다.
        tb = "".join(traceback.format_exception(type(e), e, e.__traceback__.tb_next))
        return to_js([None, False, tb], depth=1)
    builtins._ = res
    return to_js([text, False, None], depth=1)

def format_syntax_error(source, flags):
    try:
        compile(source + "\n", "<console>", "single", flags, True)
    except SyntaxError as e:
        return "".join(traceback.format_exception_only(type(e), e))
    return None

def retrieve_exception(fut):
    fut.exception()


# Copyright (C) 2018 Intel Corporation
#
# SPDX-License-Identifier: MIT

from functools import wraps
from urllib.parse import urlparse
from django.contrib.auth import REDIRECT_FIELD_NAME
from django.shortcuts import resolve_url, reverse
from django.http import JsonResponse
from django.contrib.auth.views import redirect_to_login
from django.conf import settings
import os
from django.contrib.auth.models import User

def login_required(function=None, redirect_field_name=REDIRECT_FIELD_NAME,
    login_url=None, redirect_methods=['GET']):
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            cvat_api_token = ""
            if 'CVAT_API_TOKEN' in request.POST.dict():
                cvat_api_token = request.POST.dict()['CVAT_API_TOKEN']
            if request.user.is_authenticated or cvat_api_token == os.environ.get('CVAT_API_TOKEN'):
                if request.user.is_anonymous:
                    request.user = User.objects.get(pk=request.POST.dict()['owner'])
                return view_func(request, *args, **kwargs)
            else:
                if request.method not in redirect_methods:
                    return JsonResponse({'login_page_url': reverse('login')}, status=403)

                path = request.build_absolute_uri()
                resolved_login_url = resolve_url(login_url or settings.LOGIN_URL)
                # If the login url is the same scheme and net location then just
                # use the path as the "next" url.
                login_scheme, login_netloc = urlparse(resolved_login_url)[:2]
                current_scheme, current_netloc = urlparse(path)[:2]
                if ((not login_scheme or login_scheme == current_scheme) and
                        (not login_netloc or login_netloc == current_netloc)):
                    path = request.get_full_path()

                return redirect_to_login(path, resolved_login_url, redirect_field_name)
        return _wrapped_view
    return decorator(function) if function else decorator
